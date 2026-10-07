// Pure data constants (zero imports) — extracted so low-level modules can read
// them without importing template-upload.js / state-nav.js (import-cycle fix).

/* ════ AI CHECKBOXES ════ */
const AI_FEATURES={
  perf:[
    {id:"avg",label:"Subject-wise Average",sub:"Mean marks per subject per test"},
    {id:"pct",label:"Percentage Calculation",sub:"% score per subject and overall"},
    {id:"rank",label:"Class Ranking",sub:"Rank 1–N by overall average"},
    {id:"grade",label:"Grade Assignment",sub:"A/B/C/D/F by percentage bands"},
    {id:"trend",label:"Performance Trend",sub:"Improving / Stable / Declining across tests"},
    {id:"prediction",label:"Next Test Prediction",sub:"Projected score from trend (2+ tests)"},
    {id:"percentile",label:"Percentile Calculation",sub:"Where student stands within the class"},
    {id:"subject_strength",label:"Subject Strength & Weakness",sub:"Best and weakest subject per student"},
    {id:"consistency",label:"Consistency Score",sub:"Low variance = consistent; high = unpredictable"},
    {id:"growth_rate",label:"Growth Rate",sub:"Score velocity — how fast improving or declining"},
    {id:"topper_gap",label:"Topper Gap Analysis",sub:"How far each student is from class topper"},
    {id:"cumulative",label:"Cumulative Average",sub:"Running average across all tests to date"},
  ],
  warn:[
    {id:"at_risk",label:"At-Risk Detection",sub:"Scored below pass threshold in any subject"},
    {id:"sharp_drop",label:"Sharp Drop Alert",sub:"Sudden marks drop ≥ configurable % between tests"},
    {id:"chronic_absent",label:"Chronic Absenteeism",sub:"Exceeds absence threshold near test dates"},
    {id:"volatile",label:"Volatile Performance",sub:"High score variance — inconsistent pattern"},
    {id:"multiple_fails",label:"Multiple Subject Failures",sub:"Failing in 2 or more subjects simultaneously"},
    {id:"class_difficulty",label:"Class Difficulty Flag",sub:"Subject where >40% of class is struggling"},
    {id:"plateau",label:"Plateau Detection",sub:"No improvement across 3+ consecutive tests"},
    {id:"early_warning",label:"Early Warning Score",sub:"Composite risk score for proactive intervention"},
    {id:"peer_outlier",label:"Peer Outlier",sub:"Performing unusually above or below peer group"},
    {id:"subject_collapse",label:"Subject Collapse",sub:"Was strong, now suddenly failing in a subject"},
  ],
  narr:[
    {id:"parent_summary",label:"Parent-Friendly Summary",sub:"Plain-language progress narrative for parents"},
    {id:"motivation",label:"Motivational Message",sub:"Personalised encouragement based on trend"},
    {id:"study_plan",label:"Study Plan",sub:"Targeted recommendations for weak subjects"},
    {id:"intervention",label:"Intervention Note",sub:"Teacher guidance for at-risk students"},
    {id:"strengths_letter",label:"Strengths Letter",sub:"Highlight what the student excels at"},
    {id:"competitive_readiness",label:"Competitive Readiness",sub:"Readiness signal for entrance exams (JEE/NEET/IAS)"},
    {id:"teacher_remarks_ai",label:"AI Remark Sentiment",sub:"Classify teacher remarks as positive / neutral / concern"},
    {id:"progress_narrative",label:"Progress Narrative",sub:"Story of the student's journey across all tests"},
  ],
  well:[
    {id:"stress_score",label:"Stress Indicator",sub:"Composite score from volatility, absences & trend"},
    {id:"anxiety_flag",label:"Anxiety Flag",sub:"Pattern of consistent underperformance suggesting anxiety"},
    {id:"wellbeing_summary",label:"Wellbeing Summary",sub:"Class-level psychosocial overview for teacher"},
    {id:"burnout_risk",label:"Burnout Risk",sub:"Declining performance after previous high scores"},
    {id:"resilience_score",label:"Resilience Score",sub:"Ability to recover after a drop — positive rebound"},
    {id:"engagement_index",label:"Engagement Index",sub:"Proxy for class engagement via attendance + trend"},
  ],
  mgmt:[
    {id:"class_health",label:"Class Health Score",sub:"Overall class performance index 0–100"},
    {id:"subject_audit",label:"Subject Audit",sub:"Which subjects need curriculum or teaching review"},
    {id:"intervention_priority",label:"Intervention Priority List",sub:"Ranked list of students needing immediate support"},
    {id:"test_difficulty",label:"Test Difficulty Analysis",sub:"Was the test too hard or too easy vs class history"},
    {id:"year_projection",label:"Year-End Projection",sub:"Projected final scores based on current trajectory"},
    {id:"diversity_analysis",label:"Gender & Group Analysis",sub:"Performance patterns across gender groups"},
  ],
};

// PHASE 4 — all countries now listed in the dropdown (previously only
// India was rendered; see the removed `.filter()` this replaced). Real
// translated CONTENT is still only complete for the 13 Indian languages
// (i18n/<shard>/en.json + hi.json etc, untouched by this change) — every
// other country/language combination here is dropdown-listing plumbing
// only, wired to the new i18n-countries/ skeleton (index.json + one
// manifest.json per country). Selecting e.g. Germany still calls the
// same loadLanguage("de") used everywhere else; render-i18n.js's
// existing table[key]||SR_STRINGS_EN[key] fallback means it renders in
// English until de.json content actually exists — same safe fallback
// behavior as any other missing-translation case, nothing new to guard.
//
// `folder` here is each country's directory name under i18n-countries/
// — used to fetch that single country's manifest.json lazily (only the
// moment it's selected, not all of them up front). This object is also
// the synchronous first-paint seed for the dropdown (so there's no
// empty-<select> flash while the network request is in flight) and
// remains the fallback data source for ui/common/onboarding-slider.js
// exactly as documented there.
const COUNTRY_LANGUAGES = {
  IN: { label:"India", folder:"i18n-India", defaultLang:"en", languages:[
    {code:"en",label:"English"},{code:"hi",label:"हिन्दी (Hindi)"},{code:"kn",label:"ಕನ್ನಡ (Kannada)"},
    {code:"ta",label:"தமிழ் (Tamil)"},{code:"te",label:"తెలుగు (Telugu)"},{code:"mr",label:"मराठी (Marathi)"},
    {code:"bn",label:"বাংলা (Bengali)"},{code:"gu",label:"ગુજરાતી (Gujarati)"},{code:"ml",label:"മലയാളം (Malayalam)"},
    {code:"pa",label:"ਪੰਜਾਬੀ (Punjabi)"},{code:"or",label:"ଓଡ଼ିଆ (Odia)"},{code:"as",label:"অসমীয়া (Assamese)"},
    {code:"ur",label:"اردو (Urdu)"}
  ]},
  CN: { label:"China", folder:"i18n-China", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"zh",label:"中文 (Chinese)"}] },
  US: { label:"United States", folder:"i18n-UnitedStates", defaultLang:"en", languages:[{code:"en",label:"English"}] },
  GB: { label:"United Kingdom", folder:"i18n-UnitedKingdom", defaultLang:"en", languages:[{code:"en",label:"English"}] },
  DE: { label:"Germany", folder:"i18n-Germany", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"de",label:"Deutsch (German)"}] },
  FR: { label:"France", folder:"i18n-France", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"fr",label:"Français (French)"}] },
  RU: { label:"Russia", folder:"i18n-Russia", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"ru",label:"Русский (Russian)"}] },
  AE: { label:"UAE", folder:"i18n-UAE", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"ur",label:"اردو (Urdu)"}] },
  SG: { label:"Singapore", folder:"i18n-Singapore", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"ta",label:"தமிழ் (Tamil)"}] },
  AU: { label:"Australia", folder:"i18n-Australia", defaultLang:"en", languages:[{code:"en",label:"English"}] },
  CA: { label:"Canada", folder:"i18n-Canada", defaultLang:"en", languages:[{code:"en",label:"English"}] }
};
const DEFAULT_COUNTRY = "IN";

export { AI_FEATURES, COUNTRY_LANGUAGES, DEFAULT_COUNTRY };
