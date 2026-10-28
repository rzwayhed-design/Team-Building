// Game catalogue. This is the ONLY place questions live: the server sends the
// question, choices and (for clue games) each player's private clues to phones.
// `answer` is always the index of the correct choice.

export const games = [
  {
    id: 'missing',
    arena: 'general',
    name: 'The Missing Information',
    skill: 'Collaboration',
    duration: 90,
    description: 'Each teammate gets different clues. Talk together to find the answer.',
    scenarios: [
      {
        question: 'What is the 4-digit vault code?',
        clues: [
          'The first digit is 4.',
          'The second digit is twice the first.',
          'The third digit is the second minus 5.',
          'The fourth digit is the third plus 3.',
        ],
        choices: ['4836', '4826', '4835', '8436'],
        answer: 0,
        explanation: '4 → 8 (twice 4) → 3 (8 − 5) → 6 (3 + 3).',
      },
      {
        question: 'What is the four-letter password?',
        clues: [
          'The first letter is T.',
          'The second letter is E.',
          'The third letter is A.',
          'The last letter is M.',
        ],
        choices: ['TEAM', 'MEAT', 'TAME', 'MATE'],
        answer: 0,
        explanation: 'T-E-A-M. Every clue was needed to rule out the anagrams.',
      },
    ],
  },
  {
    id: 'crisis',
    arena: 'general',
    name: 'Crisis Room',
    skill: 'Decision-making',
    duration: 75,
    description: 'Choose the best response to a business crisis.',
    scenarios: [
      {
        question: 'A critical customer-facing service goes down. What should your team do first?',
        choices: [
          'Blame the vendor publicly',
          'Confirm impact, activate incident response, and communicate',
          'Wait for complaints',
          'Promise a fix time without checking',
        ],
        answer: 1,
        explanation: 'Establish impact, coordinate response and communicate verified information.',
      },
      {
        question: 'Two urgent projects compete for one specialist. What is the best first move?',
        choices: [
          'Pick the louder stakeholder',
          'Assess impact, deadlines, and alternatives',
          'Ask the specialist to work all night',
          'Cancel both projects',
        ],
        answer: 1,
        explanation: 'Transparent prioritization beats reactive decisions.',
      },
    ],
  },
  {
    id: 'objection',
    arena: 'sales',
    name: 'Objection Battle',
    skill: 'Objection handling',
    duration: 60,
    description: 'Choose the strongest customer-focused response.',
    scenarios: [
      {
        question: 'The buyer says: “Your competitor is 20% cheaper.”',
        choices: [
          'We are simply better.',
          'Ask what is included, explore outcomes and compare total value.',
          'Offer 25% off immediately.',
          'Tell them the competitor is unreliable.',
        ],
        answer: 1,
        explanation: 'Explore the comparison and connect differentiated value to buyer priorities.',
      },
      {
        question: 'The prospect says: “Send me information.”',
        choices: [
          'Send a generic brochure and close the call.',
          'Ask which specific decision or challenge the information should address and agree on a next step.',
          'Say you cannot send anything.',
          'Call every hour until they respond.',
        ],
        answer: 1,
        explanation: 'Clarify relevance and establish a mutually useful next step.',
      },
      {
        question: 'The buyer says: “We already have a supplier.”',
        choices: [
          'Insist they replace the supplier.',
          'Ask what works well and whether any gaps or future priorities remain.',
          'Say their supplier is bad.',
          'Immediately end the meeting.',
        ],
        answer: 1,
        explanation: 'Respect the incumbent and discover unmet needs.',
      },
    ],
  },
  {
    id: 'hidden',
    arena: 'sales',
    name: 'Hidden Customer',
    skill: 'Discovery',
    duration: 90,
    description: 'Ask questions to uncover the buyer’s underlying problem.',
    scenarios: [
      {
        question: 'A retailer says “We need more WhatsApp messages.” Which discovery question is strongest?',
        choices: [
          'How many messages should we sell you?',
          'Which customer journeys are failing today, and what outcome are you targeting?',
          'Do you want the most expensive plan?',
          'Can you sign this week?',
        ],
        answer: 1,
        explanation: 'Start with the business problem and measurable outcomes.',
      },
      {
        question: 'A bank asks for a new chatbot. What should you ask first?',
        choices: [
          'What color should the bot be?',
          'Which journeys, success metrics, escalation needs, and compliance constraints matter?',
          'How many emojis should it use?',
          'Can we skip stakeholder interviews?',
        ],
        answer: 1,
        explanation: 'Good discovery covers objectives, stakeholders, constraints, and metrics.',
      },
    ],
  },
  {
    id: 'save',
    arena: 'sales',
    name: 'Save the Deal',
    skill: 'Deal strategy',
    duration: 75,
    description: 'Make the best decision when a strategic opportunity is at risk.',
    scenarios: [
      {
        question: 'Your champion leaves before final approval. What next?',
        choices: [
          'Assume the deal is lost.',
          'Map stakeholders, revalidate value with the new sponsor, and confirm the decision process.',
          'Send daily discount emails.',
          'Ask procurement to sign without approval.',
        ],
        answer: 1,
        explanation: 'Rebuild alignment and validate the buying process.',
      },
      {
        question: 'Procurement requests a last-minute 30% discount. What next?',
        choices: [
          'Accept without conditions.',
          'Explore the business reason and trade concessions for reciprocal commitments.',
          'Refuse to talk.',
          'Change the scope without telling the buyer.',
        ],
        answer: 1,
        explanation: 'Negotiate value and reciprocal terms instead of discounting automatically.',
      },
    ],
  },
];

export const getGame = id => games.find(g => g.id === id);

// Public catalogue: no answers or clues.
export const catalogue = () =>
  games.map(({ scenarios, ...g }) => ({ ...g, rounds: scenarios.length, hasClues: scenarios.some(s => s.clues) }));
