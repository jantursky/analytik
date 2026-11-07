/** Steps drawn from the start of a session. */
export const JOURNEY_STEPS = 4
/** The longest range read; a longer one is cut to its last days. */
export const JOURNEY_MAX_DAYS = 30
/** Newest sessions of the range that are read, so a busy site costs a bounded scan. */
export const JOURNEY_SESSION_CAP = 5000
