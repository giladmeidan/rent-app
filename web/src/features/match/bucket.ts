export type Bucket = 'high' | 'good' | 'partial';

/** The score's label: 80 and above high, 60-79 good, below 60 partial (a failed hard filter caps
 * the score at 59, so it is always partial). */
export function bucket(score: number): Bucket {
  if (score >= 80) return 'high';
  if (score >= 60) return 'good';
  return 'partial';
}
