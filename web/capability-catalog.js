export const tools = {
  project: {
    label:'የፕሮጀክት ለውጦች',
    name:'propose_project_edits',
    description:'Read the selected project files with read_attached_text. Propose complete replacements only for selected files that need changes. Each file is reviewed separately.',
    properties:{edits:{type:'array',minItems:1,maxItems:4,items:{type:'object',properties:{path:{type:'string'},text:{type:'string'}},required:['path','text'],additionalProperties:false}}},
  },
  browser: {
    label:'የተመረጠ የዊኪፔዲያ ገጽ አንብብ',
    name:'request_article_read',
    description:'Request a read of the exact public Wikipedia article already selected by the user. A separate approval is required. Set read to true. The app shows the result after approval.',
    properties:{read:{type:'boolean',enum:[true]}},
  },
  research: {
    label:'ምንጮችን ፈልግ',
    name:'find_references',
    description:'Ask to retrieve Wikipedia sources for a public research topic. Pass only a short topic suitable for public search.',
    properties:{query:{type:'string'},language:{type:'string',enum:['am','en']}},
  },
  desktop: {
    label:'በመስኮት ላይ እርምጃ ጠይቅ',
    name:'request_window_action',
    description:'Request one action on the Windows window already selected by the user. A separate approval is required.',
    properties:{operation:{type:'string',enum:['focus','scrollUp','scrollDown']}},
  },
  desktopControl: {
    label:'የተመረጠ ቁልፍ ወይም ሳጥን',
    name:'request_control_action',
    description:'Request use of the exact Windows control selected by the user. For a button use invoke and empty text. For a text field use setText and the exact replacement text. User approval is required.',
    properties:{operation:{type:'string',enum:['invoke','setText']},text:{type:'string'}},
  },
  source: {
    label:'AK Code Engine',
    name:'propose_source_edit',
    description:'After reading the selected source using read_attached_text, submit its complete replacement. Preserve unrelated content.',
    properties:{text:{type:'string'}},
  },
  specialist: {
    label:'ለባለሙያ ረዳት አስተላልፍ',
    name:'consult_specialist',
    description:'Request a second Hermes agent for a bounded text-only research, coding, or planning analysis. It has no tools or workspace access.',
    properties:{specialty:{type:'string',enum:['research','coding','planning']},task:{type:'string'}},
  },
  clock: {
    label:'በMCP ሰዓት ፈልግ',
    name:'request_local_time',
    description:'Request a clock lookup from the MCP connection selected by the user. A separate approval is required.',
    properties:{timezone:{type:'string',description:'IANA timezone such as Africa/Addis_Ababa'}},
  },
};
export const skills={
  summarize:{label:'ሰነድ ማጠቃለል',guidance:'Extract the main points from the attached document, distinguish facts and uncertainty, and quote only where useful. Ask for the document if it is missing.'},
  review:{label:'የኮድ ክለሳ',guidance:'Review the selected source for concrete correctness and maintainability issues. Reference the file and line when the source permits it. Suggest focused changes and tests.'},
  plan:{label:'ዕቅድ ማዘጋጀት',native:'todo',guidance:'Make a practical plan in Amharic. Identify milestones, dependencies, and the next action. Clarify ambiguous constraints.'},
};
export const providerProbe = {
  name:'confirm_tool_call',
  description:'Use this function with code READY to confirm tool calling in this connection test.',
  properties:{code:{type:'string',enum:['READY']}},
};
