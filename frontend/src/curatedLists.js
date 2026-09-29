// Two list shapes share this config, told apart by `type`:
//
// type: 'filter' — filters (applied through the same sector/city/stage/hiring/
// taskGate params the filter panel and share-URL already use) plus match (the
// same rule, as a predicate) so the card can show a live count without a
// server round-trip. Clicking the card applies those filters to the map.
//
// type: 'people' — not a startup filter at all. `people` is a plain array of
// {name, role, company, why, link}. Clicking the card expands it inline
// instead of touching the map filters. Every entry below was checked against
// either this app's own verified startups.json founders field or a live web
// search (LinkedIn/Wikipedia/company team page) before being added — no name,
// role or company here is guessed. `link` is left out where a source wasn't
// checked this round rather than guessed. If a future addition can't be
// checked, leave it out rather than invent details.
export const curatedLists = [
  {
    id: 'task-gated',
    type: 'filter',
    name: 'Task-gated only',
    description: 'Companies where applying means completing a real work-sample task first.',
    filters: { taskGate: 'yes' },
    match: (s) => s.taskGate?.enabled === true,
  },
  {
    id: 'melbourne-ai',
    type: 'filter',
    name: 'Melbourne AI startups',
    description: 'AI-sector companies based in Melbourne.',
    filters: { city: 'Melbourne', sector: 'AI' },
    match: (s) => s.city === 'Melbourne' && s.sector === 'AI',
  },
  {
    id: 'currently-hiring',
    type: 'filter',
    name: 'Currently hiring',
    description: 'Companies with open roles right now.',
    filters: { hiring: 'yes' },
    match: (s) => s.hiring === true,
  },
  {
    id: 'people-to-follow',
    type: 'people',
    name: 'AU Startup People to Follow',
    description: 'Founders, operators and investors worth following in the AU startup scene.',
    people: [
      {
        name: 'Melanie Perkins',
        role: 'Co-founder & CEO',
        company: 'Canva',
        why: 'Co-founded Canva in 2012; it is now one of the world’s most widely used design platforms.',
        link: 'https://au.linkedin.com/in/melanieperkins',
      },
      {
        name: 'Cliff Obrecht',
        role: 'Co-founder & COO',
        company: 'Canva',
        why: 'Co-founded Canva alongside Melanie Perkins and Cameron Adams.',
        link: 'https://en.wikipedia.org/wiki/Cliff_Obrecht',
      },
      {
        name: 'Cameron Adams',
        role: 'Co-founder & Chief Product Officer',
        company: 'Canva',
        why: 'Canva’s third co-founder, leading product.',
      },
      {
        name: 'Mike Cannon-Brookes',
        role: 'Co-founder & CEO',
        company: 'Atlassian',
        why: 'Co-founded Atlassian in 2002 with Scott Farquhar, funded on credit cards straight out of university.',
        link: 'https://au.linkedin.com/in/mcannonbrookes',
      },
      {
        name: 'Scott Farquhar',
        role: 'Co-founder',
        company: 'Atlassian',
        why: 'Co-founded Atlassian; now invests through Skip Capital.',
        link: 'https://en.wikipedia.org/wiki/Scott_Farquhar',
      },
      {
        name: 'Jack Zhang',
        role: 'Co-founder & CEO',
        company: 'Airwallex',
        why: 'Co-founded Airwallex in Melbourne in 2015, now global payments infrastructure.',
      },
      {
        name: 'Lucy Liu',
        role: 'Co-founder',
        company: 'Airwallex',
        why: 'One of Airwallex’s five co-founders.',
      },
      {
        name: 'Luke Anear',
        role: 'Founder & CEO',
        company: 'SafetyCulture',
        why: 'Founded SafetyCulture in Townsville in 2004; now a major workplace-operations platform.',
      },
      {
        name: 'Didier Elzinga',
        role: 'Co-founder',
        company: 'Culture Amp',
        why: 'Co-founded Culture Amp in 2011 and led it as CEO for 15 years, recently stepping down as CEO.',
        link: 'https://au.linkedin.com/in/didierelzinga',
      },
      {
        name: 'Ben Thompson',
        role: 'Co-founder & CEO',
        company: 'Employment Hero',
        why: 'Co-founded Employment Hero in 2014, now a major HR and payroll platform.',
      },
      {
        name: 'Katherine McConnell',
        role: 'Founder & CEO',
        company: 'Brighte',
        why: 'Founded Brighte to make home solar and electrification financing accessible.',
      },
      {
        name: 'Tim Doyle',
        role: 'Co-founder & CEO',
        company: 'Eucalyptus',
        why: 'Co-founded Eucalyptus, which runs a portfolio of digital healthcare brands.',
      },
      {
        name: 'Anthony Eisen',
        role: 'Co-founder',
        company: 'Afterpay',
        why: 'Co-founded Afterpay in 2014, pioneering buy-now-pay-later before its 2022 acquisition by Block.',
        link: 'https://en.wikipedia.org/wiki/Anthony_Eisen',
      },
      {
        name: 'Nick Molnar',
        role: 'Co-founder',
        company: 'Afterpay',
        why: 'Co-founded Afterpay with Anthony Eisen at 24, becoming Australia’s youngest self-made billionaire.',
        link: 'https://www.linkedin.com/in/nick-molnar-478a642a/',
      },
      {
        name: 'Grace Brown',
        role: 'Co-founder & CEO',
        company: 'Andromeda Robotics',
        why: 'Founded Andromeda Robotics at 22 to build empathetic companion robots for aged care.',
        link: 'https://www.linkedin.com/in/grace-brown-619b59161/',
      },
      {
        name: 'Anastasia Volkova',
        role: 'Co-founder & CEO',
        company: 'Regrow',
        why: 'Co-founded Regrow (formerly Flurosat), using satellite and drone data for agriculture.',
      },
      {
        name: 'Anshul Jain',
        role: 'Co-founder',
        company: 'Everlab',
        why: 'Co-founded Everlab, building preventative healthcare and longevity diagnostics.',
        link: 'https://au.linkedin.com/in/anshuljain32',
      },
      {
        name: 'Anna Wright',
        role: 'Co-founder & CEO',
        company: 'BindiMaps',
        why: 'Founded BindiMaps, indoor wayfinding technology for people with vision impairment.',
        link: 'https://au.linkedin.com/in/anna-wright-35440b38',
      },
      {
        name: 'Cole Cornford',
        role: 'Founder & CEO',
        company: 'Galah Cyber',
        why: 'Founded Galah Cyber, an application-security consultancy, after an AppSec career at Westpac and the ATO.',
        link: 'https://au.linkedin.com/in/colecornford',
      },
      {
        name: 'Niki Scevak',
        role: 'Co-founder & Partner',
        company: 'Blackbird Ventures',
        why: 'Co-founded Startmate, then Blackbird Ventures, backing Canva and Airwallex early.',
        link: 'https://www.blackbird.vc/team/niki-scevak',
      },
      {
        name: 'Craig Blair',
        role: 'Co-founder & Managing Partner',
        company: 'AirTree Ventures',
        why: 'Co-founded AirTree Ventures in 2014, one of Australia’s largest early-stage VC firms.',
        link: 'https://www.airtree.vc/team/craig-blair',
      },
    ],
  },
];
