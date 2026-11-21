export const tools = {
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
  plan:{label:'ዕቅድ ማዘጋጀት',guidance:'Make a practical plan in Amharic. Identify milestones, dependencies, and the next action. Clarify ambiguous constraints.'},
};
export const providerProbe = {
  name:'confirm_tool_call',
  description:'Use this function with code READY to confirm tool calling in this connection test.',
  properties:{code:{type:'string',enum:['READY']}},
};
