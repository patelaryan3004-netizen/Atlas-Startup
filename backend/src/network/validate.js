// Checking what people send, in one place. Every refusal is an ApiError, which the router turns into a plain sentence and a status.
import { randomBytes } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (message) => new ApiError(400, message, 'invalid');
export const unauthorized = (message = 'Sign in to do that.') => new ApiError(401, message, 'unauthorized');
export const forbidden = (message = 'You cannot do that.') => new ApiError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new ApiError(404, message, 'not_found');
export const tooMany = (message = 'Too many attempts. Try again later.') => new ApiError(429, message, 'rate_limited');

// An id that sorts by when it was made, and cannot be guessed from the one before. Two made in the same millisecond still sort in the order they were
// made (the clock it reads never goes back or stands still), which is what the feed's order and its pages rely on.
let lastStamp = 0;
export const makeId = (prefix, now = Date.now()) => {
  lastStamp = Math.max(now, lastStamp + 1);
  return `${prefix}_${lastStamp.toString(36).padStart(9, '0')}${randomBytes(5).toString('hex')}`;
};

// Control characters and the invisible ones used to hide text. A tab or a line break is kept only where the text may have lines.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g;

// A piece of text from a person. Single-line text has its white space collapsed; multi-line text keeps its line breaks (never more than one blank line).
export function cleanText(value, { name, min = 0, max, multiline = false, required = false }) {
  if (value === undefined || value === null) {
    if (required) throw bad(`${name} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw bad(`${name} must be text.`);
  let text = value.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  text = multiline ? text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
  if (!text && required) throw bad(`${name} is required.`);
  if (text && text.length < min) throw bad(`${name} needs at least ${min} characters.`);
  if (text.length > max) throw bad(`${name} can be at most ${max} characters.`);
  return text;
}

// A web address a person gives for their own page: https only, no password in it, not absurdly long. Returns the address as the URL class writes it.
export function httpsUrl(value, { name, required = false }) {
  const text = cleanText(value, { name, max: 300, required });
  if (!text) return '';
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch (e) { throw bad(`${name} is not a web address.`); }
  if (url.protocol !== 'https:') throw bad(`${name} must start with https://`);
  if (url.username || url.password) throw bad(`${name} cannot hold a user name or password.`);
  if (!url.hostname.includes('.')) throw bad(`${name} is not a web address.`);
  return url.href;
}

export const looksLikeEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// How many web addresses a piece of text holds: a post or a reply may carry a couple, and more is how spam looks.
export const linkCount = (text) => (String(text).match(/(?:https?:\/\/|www\.)\S+/gi) ?? []).length;

export function oneOf(value, list, name) {
  if (!list.includes(value)) throw bad(`${name} must be one of: ${list.join(', ')}.`);
  return value;
}

export const initialsOf = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0].toUpperCase()).join('');
