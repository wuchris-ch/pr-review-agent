#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { isRetryableHttpStatus, retryDelayMs } from './retry-policy.js';
import { REVIEW_SYSTEM_PROMPT } from './system-prompt.js';

const MAX_INPUT_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 50_000;
const MAX_REQUEST_ATTEMPTS = 2;

class RetryableModelRequestError extends Error {}

interface ChatCompletion {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error('model gateway configuration is incomplete');
  }
  return value;
}

function completionsUrl(baseUrl: string): URL {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalized);
}

function startTelemetry(): NodeSDK | undefined {
  if (
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    && !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ) {
    return undefined;
  }

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'pr-review-agent',
    // Process arguments and environment can contain sensitive review context.
    autoDetectResources: false,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  sdk.start();
  return sdk;
}

async function responseBody(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) {
    throw new Error('model gateway response exceeded the safe byte limit');
  }
  return bytes.toString('utf8');
}

function outputText(payload: ChatCompletion): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('model gateway returned no text');
  }
  return content;
}

async function requestReview(
  input: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  span: Span,
): Promise<string> {
  const url = completionsUrl(baseUrl);
  span.setAttributes({
    'gen_ai.operation.name': 'chat',
    'gen_ai.request.model': model,
    'review.input_bytes': Buffer.byteLength(input, 'utf8'),
  });

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: REVIEW_SYSTEM_PROMPT },
            { role: 'user', content: input },
          ],
          max_tokens: 4096,
          temperature: 0,
        }),
        signal: controller.signal,
      });
      span.setAttribute('http.response.status_code', response.status);
      const body = await responseBody(response);
      if (!response.ok) {
        const ErrorType = isRetryableHttpStatus(response.status)
          ? RetryableModelRequestError
          : Error;
        throw new ErrorType(`model gateway returned HTTP ${String(response.status)}`);
      }
      let parsed: ChatCompletion;
      try {
        parsed = JSON.parse(body) as ChatCompletion;
      } catch {
        throw new Error('model gateway returned invalid JSON');
      }
      span.setAttributes({
        'review.request_attempts': attempt,
        'review.request_retried': attempt > 1,
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return outputText(parsed);
    } catch (error) {
      const retryable = error instanceof RetryableModelRequestError
        || (error instanceof Error && error.name === 'AbortError')
        || error instanceof TypeError;
      if (retryable && attempt < MAX_REQUEST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
        continue;
      }
      span.setAttributes({
        'review.request_attempts': attempt,
        'review.request_retried': attempt > 1,
      });
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('model gateway request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('model gateway request failed');
}

async function main(): Promise<void> {
  const apiKey = requiredEnvironment('MODEL_GATEWAY_API_KEY');
  const baseUrl = requiredEnvironment('MODEL_GATEWAY_BASE_URL');
  const model = requiredEnvironment('REVIEW_AGENT_MODEL');
  const bytes = readFileSync(0);
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES) {
    throw new Error('review input is empty or exceeds the safe byte limit');
  }
  const input = bytes.toString('utf8');
  const sdk = startTelemetry();

  try {
    const tracer = trace.getTracer('pr-review-agent');
    const output = await tracer.startActiveSpan(
      'review.model.request',
      async (span) => {
        try {
          return await requestReview(input, apiKey, baseUrl, model, span);
        } finally {
          span.end();
        }
      },
    );
    process.stdout.write(output);
  } finally {
    await sdk?.shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  process.stderr.write(`model request failed: ${message}\n`);
  process.exitCode = 1;
});
