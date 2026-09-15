export type Category = {
  id: string;
  name: string;
};

export type Subtopic = {
  name: string;
  detail: string;
};

export type Concept = {
  id: string;
  cat: string;
  title: string;
  one: string; // plain-English one-liner, <20 words
  why: string; // why this concept exists / what problem it solves
  how: string; // how it actually works, the mechanism
  when: string; // when to use it, and when not to
  ref: string; // named source (docs, book, or standard reference)
  subtopics: Subtopic[]; // 3-5 subtopics with short explanations
  code: string; // real-world JavaScript (Node.js) example
  steps: string[]; // 3-5 steps rendered as the animated flow diagram
};
