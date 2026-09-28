// Archetypes (main stats) and their four skills each.
// quote = the small-caps subtitle shown as a hover tooltip.
// description = the parenthetical text always shown under the skill name.

const SKILLS = {
  fortitude: [
    {
      key: "exertion",
      name: "Exertion",
      quote: "I’D SOONER BECOME ASH THAN DUST.",
      description: "Physical strength, punching down a door, remaining on your last legs.",
    },
    {
      key: "adaptability",
      name: "Adaptability",
      quote: "THE LAST WILL BE LAST WHEN THE FIRSTS ARE UNREACHABLE.",
      description: "Your ability to adapt to an immediate change in situation, how well you can move around. Detected and non.",
    },
    {
      key: "weathering",
      name: "Weathering",
      quote: "IN THE DEPTHS OF WINTER I FOUND IN MYSELF AN INVINCIBLE SUMMER.",
      description: "Your ability to take hits and keep going.",
    },
    {
      key: "medicine",
      name: "Medicine",
      quote: "IN A LITTLE WHILE, I’LL BE GONE.",
      description: "How well you can medicate yourself and others. If you can patch up someone in a hurry or not.",
    },
  ],
  prudence: [
    {
      key: "logic",
      name: "Logic",
      quote: "EVERYONE’S CONNECTED. EVERYTHING’S CONNECTED.",
      description: "Putting together a reasoning, a motive, two lines on a board.",
    },
    {
      key: "abstraction",
      name: "Abstraction",
      quote: "THE RAIN WAS OCEAN TOO, ONCE.",
      description: "Your ability to understand a single concept, to look at the greater picture and focus on a single part.",
    },
    {
      key: "anthropology",
      name: "Anthropology",
      quote: "THE SMELL OF BLOOD BRINGS BACK TRACES OF LIFE.",
      description: "How well you pull out facts from the depths of your brains. A hint to connect the dots, or an unrelated piece of trivia.",
    },
    {
      key: "perception",
      name: "Perception",
      quote: "A WORLD BOTH ATOMIC AND GREAT.",
      description: "How well you notice what is happening around you.",
    },
  ],
  temperance: [
    {
      key: "empathy",
      name: "Empathy",
      quote: "CONSUME AND BE CONSUMED IN KIND.",
      description: "Your ability to empathize with others and understand.",
    },
    {
      key: "influence",
      name: "Influence",
      quote: "STAY HERE A LITTLE LONGER.",
      description: "Your ability to convince others. How well you can work others to make them believe or trust you.",
    },
    {
      key: "ceremony",
      name: "Ceremony",
      quote: "READING FROM DEAD EYES.",
      description: "How well you know how to act in public. A rehearsal of a speech.",
    },
    {
      key: "will_to_power",
      name: "Will to Power",
      quote: "YOU WANTED TO LIVE.",
      description: "Your strength of being. How strong your volition is.",
    },
  ],
  justice: [
    {
      key: "rigour",
      name: "Rigour",
      quote: "SMELLING BLOOD, PRAYING FOR RAIN.",
      description: "Your ability to stay composed when the unforeseen happens. To not flinch or react when caught off-guard.",
    },
    {
      key: "serrated_olive_branch",
      name: "Serrated Olive Branch",
      quote: "IT BURNS IN YOUR HEART: IT’S HATRED MOVED BY LOVE.",
      description: "Your faith and your ability to wield it. Both in the arcane sense, the ideological one, and the charismatic one.",
    },
    {
      key: "last_call",
      name: "Last Call",
      quote: "THE LONG, LONG WAY.",
      description: "How well you handle death. Also how well you recognize it.",
    },
    {
      key: "eternal_horizon",
      name: "Eternal Horizon",
      quote: "I BELIEVE I CAN LIVE I CAN DIE.",
      description: "Your ability to sense events into the future. To feel your destiny.",
    },
  ],
};

const ARCHETYPES = ["fortitude", "prudence", "temperance", "justice"];

// ---- Derived stats (shared by the creator and the sheet) ----
// All divisions round down.

// HP = (98 + Weathering) + ((2.0 + 0.2 * Weathering) * Level)
// (2.0 + 0.2 * W) equals (10 + W) / 5, so this is done in whole numbers
// to avoid floating-point rounding surprises.
function calcMaxHp(weathering, level) {
  return 98 + weathering + Math.floor(((10 + weathering) * level) / 5);
}

// SP = (10 + Will to Power) + (Level / 2)
function calcMaxSp(willToPower, level) {
  return 10 + willToPower + Math.floor(level / 2);
}

// Speed (tiles in any direction) = 3 + (Adaptability / 2)
function calcSpeed(adaptability) {
  return 3 + Math.floor(adaptability / 2);
}

// ---- Panic types ----
// Decided by which archetype the character's signature skill belongs to.

const PANIC_TYPES = {
  fortitude: {
    name: "Murder",
    description:
      "When the character's SP hits 0, the player becomes unable to choose any attacks to be done, and the character will randomly start attacking with random attacks.",
  },
  prudence: {
    name: "Suicide",
    description:
      "When the character's SP hits 0, the player has 2 turns to heal the SP back to full before the character kills themselves.",
  },
  temperance: {
    name: "Wander",
    description:
      "When the character's SP hits 0, the panicking character will move randomly around the map, and when near any ally, that ally will lose 10 SP at the start of their turn.",
  },
  justice: {
    name: "Sabotage",
    description:
      "When the character's SP hits 0, they will corrode into a random E.G.O they have and hit as many random units as they can.",
  },
};

// Returns the archetype key ("fortitude", ...) that owns a skill, or null.
function archetypeOfSkill(skillKey) {
  for (const archetype of ARCHETYPES) {
    if (SKILLS[archetype].some((skill) => skill.key === skillKey)) {
      return archetype;
    }
  }
  return null;
}
