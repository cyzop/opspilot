export class OpsPilotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends OpsPilotError {}
export class DomainValidationError extends OpsPilotError {}
export class UnknownServiceError extends OpsPilotError {}
export class UnknownIncidentError extends OpsPilotError {}
export class UnknownRunbookError extends OpsPilotError {}
export class UnknownConversationError extends OpsPilotError {}
export class UnknownStrategyError extends OpsPilotError {}
export class RequestTimeoutError extends OpsPilotError {}
export class StrategyLimitError extends OpsPilotError {}
export class MemoryValidationError extends DomainValidationError {}
export class InvalidEmbeddingError extends OpsPilotError {}
export class ModelUnavailableError extends OpsPilotError {}
export class UnknownRequestError extends OpsPilotError {}
