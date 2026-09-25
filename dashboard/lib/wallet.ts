/** "7fL9k2...mQ4p" style: first `head` (default 6) + "..." + last 4 characters. */
export function shortAddress(address: string, head = 6): string {
  return address.length <= head + 7 ? address : `${address.slice(0, head)}...${address.slice(-4)}`;
}
