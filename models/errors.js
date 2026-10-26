// One error type for every model call. `kind` is what the caller branches on; nothing here ever turns a failure into a success value.
export class ProviderError extends Error {
  constructor(kind, message, { provider, job, status = null, body = null } = {}) {
    super(`${provider ?? '?'}/${job ?? '?'} ${kind}: ${message}`);
    this.name = 'ProviderError';
    this.kind = kind; // unsupported | config | http | timeout | network | parse | refusal | fixture_missing | forbidden
    this.provider = provider; this.job = job; this.status = status; this.body = body;
  }
}
export const unsupported = (provider, job) => new ProviderError('unsupported', `${provider} does not serve this job; pick another provider with MODEL_PROVIDER_${job.toUpperCase()}`, { provider, job });
