import { ZodArray, ZodObject, ZodOptional, z } from 'zod';

// Utility to derive default values from a Zod schema
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getDefaultValue = (schema: z.ZodType): any => {
  if (schema instanceof ZodObject) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultObject: Record<string, any> = {};
    const shape = schema.shape;

    for (const key in shape) {
      const field = shape[key];
      const value = getDefaultValue(field);
      // Only add the key if it's not undefined (skip optional fields)
      if (value !== undefined) {
        defaultObject[key] = value;
      }
    }
    return defaultObject;
  }

  if (schema instanceof ZodArray) {
    return []; // Default for arrays is an empty array
  }

  if (schema instanceof ZodOptional) {
    return undefined; // Default for optional fields is `undefined`
  }

  if (schema.safeParse(null).success) {
    return null; // Default for nullable fields is `null`
  }

  // Return primitive defaults based on common types
  switch (schema.constructor) {
    case z.ZodNumber:
      return 0;
    case z.ZodString:
      return '';
    case z.ZodBoolean:
      return false;
    case z.ZodDate:
      return new Date();
    default:
      return undefined; // Default for unhandled types
  }
};
