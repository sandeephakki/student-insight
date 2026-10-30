// bal/smart-plan/quality-config.js  (Smart Planner v2, amendments A1-A6)
// CONSTANTS ONLY - no logic, no imports. Every threshold used by the parser, quality checks, trend and
// scrubber lives here and nowhere else (smart-planner-11-amendments: "Never duplicate a threshold inside another module").
// Later tasks APPEND below.

// ---- task 13: ID-set gate (the hard gate; the token is only a soft check) ----
// Share of the prompt's student ids that must appear in the result. Below this the result belongs to another
// class/prompt and is blocked (wrong_class). At or above it, missing ids are simply re-askable (needRegenerate).
export const ID_OVERLAP_MIN_SHARE = 0.5;
// The validation token is searched in the head of the text (everything before the first student block) and,
// failing that, in the first N characters.
export const TOKEN_HEAD_CHARS = 600;

// ---- task 12: parser tolerance ----
// Result texts that look like these binary containers are not readable as text.
export const BINARY_MAGIC = ['PK\u0003\u0004', '%PDF', '\u00D0\u00CF\u0011\u00E0'];   // zip(docx/pages/odt) / pdf / legacy .doc
export const UNREADABLE_EXTENSIONS = ['docx', 'doc', 'pdf', 'pages', 'odt', 'xlsx', 'png', 'jpg', 'jpeg', 'zip'];
export const BINARY_CTRL_CHAR_SHARE = 0.02;      // >2% control characters (outside \t \n \r) = not text
export const RTF_MAX_DEPTH_SKIP = ['fonttbl', 'colortbl', 'stylesheet', 'info', 'expandedcolortbl', 'listtable', 'listoverridetable', 'generator', 'pict', 'header', 'footer'];

// ---- task 14: trend line (facts computed by StudIn, not opinion) ----
export const TREND_SHARP_DROP_PCT = 20;          // overall % points, last test vs first OR vs previous -> sharp_decline
export const TREND_DROP_PCT = 8;                 // net change <= -8 (or last step <= -10) -> decline
export const TREND_LAST_STEP_DROP_PCT = 10;
export const TREND_RISE_PCT = 8;                 // net change >= +8 -> improving
export const TREND_SHARP_RISE_PCT = 20;          // net change >= +20 -> strong_improvement

// ---- task 14: scrubber - generic words of an institution name that must NOT be scrubbed from free text ----
export const GENERIC_INSTITUTION_WORDS = [
  'school', 'schools', 'public', 'private', 'college', 'institute', 'institution', 'academy', 'university',
  'high', 'higher', 'secondary', 'primary', 'senior', 'junior', 'middle', 'elementary', 'international',
  'convent', 'vidyalaya', 'vidya', 'vidyamandir', 'mandir', 'pathshala', 'shala', 'kendra', 'kendriya',
  'english', 'medium', 'model', 'central', 'national', 'state', 'government', 'govt', 'aided', 'unaided',
  'residential', 'day', 'boys', 'girls', 'memorial', 'trust', 'society', 'education', 'educational', 'class', 'classes',
];

// ---- task 15: quality checks (per student) ----
export const FOCUS_MIN = 1;
export const FOCUS_MAX = 3;
export const NEXTSTEPS_MIN = 3;
export const NEXTSTEPS_MAX = 5;
export const MIN_NOTE_CHARS = 12;                // a SubjectNotes line shorter than this is empty
export const NOTES_WITH_NUMBERS_MIN_SHARE = 0.5; // at least half of a student's SubjectNotes must quote a number
export const REUSE_MIN_STUDENTS = 3;             // a sentence found in this many different students is "reused"
export const REUSE_MIN_CHARS = 40;               // ignore short sentences when looking for reuse
export const REUSE_FLAG_MIN_SENTENCES = 2;       // student flagged when this many of THEIR sentences are reused
export const ID_REPLACEMENT_PARENT = 'your child';
export const ID_REPLACEMENT_OTHER = 'the student';
// Gentle wording must still count as acknowledging a decline, so a kind summary is never flagged as a contradiction.
export const DECLINE_WORDS = ['dip', 'drop', 'declin', 'fell', 'fall', 'slip', 'lower', 'down', 'concern', 'weaken', 'worsen', 'decreas', 'struggl', 'eased', 'settled', 'softer', 'below', 'bounce', 'recover', 'rebuild', 'regain', 'room to', 'unsettled', 'tougher', 'challeng'];
// Only PAST-TENSE factual claims of improvement contradict a declining trend. Hopeful future wording ("can improve",
// "will grow stronger") is exactly the tone we want and must never be flagged.
export const IMPROVE_FACT_WORDS = ['improved', 'rose', 'risen', 'gained', 'climbed', 'went up', 'jumped', 'soared', 'increased', 'grew', 'has grown', 'improving', 'turnaround', 'rising', 'climbing', 'gaining', 'getting better', 'upward'];
export const IMPROVE_WORDS = ['improv', 'rising', 'rose', 'rise', 'progress', 'turnaround', 'gain', 'stronger', 'upward', 'climb', 'better'];
// Quality codes that make a student worth re-asking. Anything else is informational.
export const REDO_CODES = ['harsh_tone', 'missing_subject_notes', 'too_few_focus', 'too_many_focus', 'too_few_steps', 'too_many_steps', 'no_scores_cited', 'reused_sentences', 'trend_contradiction', 'empty_field', 'wrong_language'];

// ---- output-language check (the prompt asks for the teacher's language; the reply is VERIFIED, never assumed) ----
// language name (lower case, as shown in the language picker) -> Unicode range of its script. Latin-script languages are not checked.
export const LANGUAGE_SCRIPTS = {
  kannada: '\u0C80-\u0CFF', hindi: '\u0900-\u097F', marathi: '\u0900-\u097F', sanskrit: '\u0900-\u097F', nepali: '\u0900-\u097F',
  tamil: '\u0B80-\u0BFF', telugu: '\u0C00-\u0C7F', malayalam: '\u0D00-\u0D7F', bengali: '\u0980-\u09FF', assamese: '\u0980-\u09FF',
  gujarati: '\u0A80-\u0AFF', punjabi: '\u0A00-\u0A7F', odia: '\u0B00-\u0B7F', urdu: '\u0600-\u06FF',
  chinese: '\u4E00-\u9FFF', russian: '\u0400-\u04FF',
};
export const LANGUAGE_MIN_SHARE = 0.35;   // share of a student's LETTERS that must be in the requested script (chapter/subject names stay English)

// Latin-script output languages (German, French) cannot be checked by script. They are checked by what they must NOT be: English.
// A reply whose words are this share (or more) common English function words is treated as "answered in English".
export const LATIN_SCRIPT_LANGUAGES = ['german', 'french'];
export const ENGLISH_FUNCTION_WORDS = ['the', 'and', 'of', 'to', 'is', 'are', 'in', 'with', 'for', 'that', 'this', 'on', 'be', 'was', 'has', 'have', 'your', 'their', 'it', 'by', 'student', 'needs'];
export const ENGLISH_SHARE_MAX = 0.15;

// ---- tone check (English words only; the prompt's TONE CHARTER asks for kind, hopeful, strengths-first writing) ----
export const HARSH_WORDS = ['fail', 'failed', 'failing', 'failure', 'weak', 'weakness', 'weaknesses', 'poor', 'poorly', 'bad', 'worst', 'lazy', 'hopeless', 'dumb', 'stupid', 'struggling', 'struggles', 'at risk', 'at-risk', 'alarming', 'drastic', 'plummet', 'plummeted', 'collapse', 'collapsed', 'disaster', 'terrible', 'awful', 'pathetic', 'careless', 'underperform', 'underperforming', 'underperformance', 'bottom of the class', 'slow learner', 'serious concern', 'red flag'];
