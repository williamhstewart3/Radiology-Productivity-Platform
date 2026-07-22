export function watcherReceiptBody(totalRows: number, reviewRows: number): string {
  return `${Math.max(0, totalRows - reviewRows)} counted quietly, ${reviewRows} in Inbox`;
}
