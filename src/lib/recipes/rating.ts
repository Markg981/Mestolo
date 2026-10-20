/** Numero minimo di valutazioni prima di mostrare la media: evita il rumore su 1-2 voti. */
export const MIN_RATINGS_TO_SHOW = 3;

export interface RatingAggregate {
  rating_avg: number | string | null;
  rating_count: number;
}

export function showRating(r: RatingAggregate): boolean {
  return r.rating_avg !== null && r.rating_count >= MIN_RATINGS_TO_SHOW;
}

/** Aggregato per i dati strutturati (schema.org AggregateRating), o null se non ancora mostrabile. */
export function aggregateRatingJsonLd(r: RatingAggregate) {
  if (!showRating(r)) return null;
  return {
    '@type': 'AggregateRating',
    ratingValue: Number(r.rating_avg),
    ratingCount: r.rating_count,
    bestRating: 5,
    worstRating: 1,
  };
}
