// src/utils/ssrf.js — SSRF protection utility
// Blocks requests to private/internal network addresses

const { URL } = require('url');

/**
 * Private and restricted IP/hostname patterns.
 * Covers RFC 1918 private ranges, loopback, link-local (AWS metadata),
 * IPv6 private, and well-known cloud metadata hostnames.
 */
const BLOCKED_HOSTNAME_PATTERNS = [
  // IPv4 loopback
  /^127\./,
  // IPv4 link-local (AWS/GCP/Azure instance metadata)
  /^169\.254\./,
  // RFC 1918 private ranges
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  // IPv4 broadcast/reserved
  /^0\./,
  /^255\./,
  // IPv6 loopback and private
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',  // AWS/Azure metadata (explicit string match)
  '100.100.100.200',  // Alibaba Cloud metadata
]);

/**
 * Check whether a URL is safe to proxy/forward to.
 * Returns { safe: true } or { safe: false, reason: string }.
 *
 * @param {string} urlStr - The URL to check.
 * @returns {{ safe: boolean, reason?: string }}
 */
function checkSafeUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // Only allow http and https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { safe: false, reason: `Protocol '${parsed.protocol}' is not allowed; use http or https` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Exact match against blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: 'URL points to a blocked/internal hostname' };
  }

  // Pattern match
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return { safe: false, reason: 'URL points to a private or reserved IP address' };
    }
  }

  // Block numeric IPs that don't have a TLD (raw IPv4 not in above ranges)
  // e.g. "192.0.2.1" (documentation range) or other numeric IPs
  const isRawIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (isRawIpv4) {
    return { safe: false, reason: 'Direct IP-based endpoints are not permitted; use a publicly resolvable hostname' };
  }

  return { safe: true };
}

module.exports = { checkSafeUrl };
