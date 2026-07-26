import { z } from 'zod';

export const parseFormBoolean = (value) => {
  if (value === true || value === false) return value;
  if (value === undefined || value === null || value === '') return undefined;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }

  if (value === 1) return true;
  if (value === 0) return false;

  return Boolean(value);
};

export const formBoolean = (defaultValue) =>
  z.preprocess((value) => {
    const parsed = parseFormBoolean(value);
    return parsed === undefined ? defaultValue : parsed;
  }, z.boolean());

export const optionalFormBoolean = () =>
  z.preprocess((value) => parseFormBoolean(value), z.boolean().optional());
