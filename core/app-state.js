// Single in-memory app state object. Zero imports on purpose: every layer can
// import APP from here without joining the core/state-nav.js import cycle.
const APP={currentStep:"home",country:"IN",features:{},setupCard1Choice:"new",setup:{mode:"institution",modeLocked:false,instName:"",instType:"",location:"",contact:"",className:"",section:"",year:"",teacher:"",scoring:{marks:true,pct:true,grade:false,pf:false},passThreshold:35,absentAlert:3,dropAlert:20,subjects:[],tests:[]},rawData:null,students:[],classStats:null,genderAnalysis:null,filter:"all",sort:"rank",aiFeatures:new Set(),individualSelectedId:null,
  // mergeSource holds the already-filled MARKS+CONTEXT sheet (header row +
  // real student rows, as plain arrays) when the teacher loads an existing
  // workbook via "Update Existing Sheet" on the Setup step. When set,
  // generateTemplate() appends new-test columns onto these exact rows
  // instead of building a fresh 5-sample-row workbook — see
  // generateMergedTemplate() for why this exists: the plain "Download
  // Template" button always regenerates from scratch and has no way to
  // know a previous file's marks should be preserved.
  mergeMode:false,mergeSource:null,_pendingMerge:null,
  // ── COMPARE SECTIONS MODE (Institution only) ──
  // compareMode: entered by dropping 2+ files on Home's single upload
  // zone (no dedicated "Compare" entry point anymore — v3.1). sections[]
  // holds one entry per uploaded section/batch file: {id,fileName,rawData,
  // label,valid,errors,rowCount,students,classStats,genderAnalysis,dataIssues}.
  // sectionComparison is the computed cross-section ranking/aggregate built
  // by computeSectionComparison() once every valid section has been analysed.
  compareMode:false,sections:[],sectionComparison:[],
  // ── HOME SINGLE-FILE CARD ── the non-compare-mode counterpart to
  // sections[] above: set once a lone Home upload passes validation, so
  // renderHomeFileList() can show the same "here's what's uploaded, ✕ to
  // remove it before running" card whether it's 1 file or several.
  homeSingleFile:null
  ,setupWizardStep:1  // 1–4, session-only
};

export { APP };
if(typeof window!=='undefined'){window.APP=APP;}
