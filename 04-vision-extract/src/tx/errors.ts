/** Raised when model inference fails. */
export class ModelInferenceError extends Error {
  override readonly name = 'ModelInferenceError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** Raised when image processing fails. */
export class ImageProcessingError extends Error {
  override readonly name = 'ImageProcessingError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
