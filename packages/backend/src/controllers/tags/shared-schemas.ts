import { z } from 'zod';

const nameSchema = () => z.string().min(1, 'Name is required').max(100, 'Name must not exceed 100 characters').trim();

const colorSchema = () =>
  z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color (e.g., #FF5733)')
    .transform((v) => v.toLowerCase());

const iconSchema = () => z.string().max(50, 'Icon name must not exceed 50 characters').nullable().optional();

const descriptionSchema = () => z.string().max(500, 'Description must not exceed 500 characters').nullable().optional();

export const createTagBodyShape = {
  name: nameSchema(),
  color: colorSchema(),
  icon: iconSchema(),
  description: descriptionSchema(),
};

export const createTagBodySchema = z.object(createTagBodyShape);

export const updateTagBodyShape = {
  name: nameSchema().optional(),
  color: colorSchema().optional(),
  icon: iconSchema(),
  description: descriptionSchema(),
};

export const updateTagBodySchema = z.object(updateTagBodyShape);
