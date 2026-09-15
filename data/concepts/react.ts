import type { Concept } from "../types";

export const REACT: Concept[] = [
  {
    id: "react-components",
    cat: "react",
    title: "Components",
    one: "Reusable functions that return UI, the building blocks of every React app.",
    why: "Copying the same markup across pages guarantees drift. Components let you write a piece of UI once and reuse it everywhere, so a fix in one place applies to every screen that renders it.",
    how: "A component is a function that takes props and returns markup (JSX). React calls your function whenever it renders, compares the output with the previous render, and updates only the parts of the DOM that changed.",
    when: "Use a component whenever markup or behavior repeats, or when a piece of state plus its UI belong together. Don't split into components so finely that reading the tree is harder than reading one file.",
    ref: "React Documentation",
    subtopics: [
      { name: "Composition", detail: "Apps are trees of components; small components compose into larger features, and data flows down through props." },
      { name: "Pure rendering", detail: "A component should render the same output for the same props and state — side effects belong in event handlers or useEffect." },
      { name: "PascalCase", detail: "Component names must start with a capital letter so JSX treats them as components, not HTML tags." },
    ],
    code: `// @jsx
// A component is just a function that returns JSX
function Badge({ label, count }) {
  return (
    <span className="badge">
      {label}: {count}
    </span>
  );
}

// Components compose into larger UI
function OrderSummary() {
  return (
    <div>
      <Badge label="Items" count={3} />
      <Badge label="Warnings" count={0} />
    </div>
  );
}`,
    steps: ["Define component", "React calls it", "Returns JSX", "DOM updated"],
  },
  {
    id: "react-jsx",
    cat: "react",
    title: "JSX",
    one: "HTML-like syntax compiled to JavaScript function calls describing the UI.",
    why: "Building UI by calling createElement everywhere is unreadable. JSX lets you write markup inline with your logic while staying 100% JavaScript — every tag becomes a function call at build time.",
    how: "The compiler transforms JSX into plain objects describing elements (type, props, children). Curly braces embed any JavaScript expression; attributes map to props, and className/style replace the HTML equivalents.",
    when: "Use JSX for all React markup. Remember it is syntax sugar — conditions, maps, and variables work because they are plain JS expressions inside braces.",
    ref: "React Documentation",
    subtopics: [
      { name: "Expressions in braces", detail: "{user.name}, {items.length > 0 && ...} — any expression works; statements (if, for) do not." },
      { name: "One root element", detail: "A JSX expression must have a single root; wrap siblings in a div or the invisible <> fragment." },
      { name: "camelCase attributes", detail: "class becomes className, tabindex becomes tabIndex, and style takes an object, not a string." },
    ],
    code: `// @jsx
// JSX compiles to element objects — this markup...
const el = (
  <a href="/docs" className="link">
    Docs
  </a>
);

// ...is really just JavaScript:
const same = {
  type: "a",
  props: { href: "/docs", className: "link", children: "Docs" },
};

// Expressions in braces are plain JS
const greeting = <p>Hello, {user.firstName ?? "guest"}</p>;`,
    steps: ["Write JSX", "Compiler transforms", "Element objects created", "React renders them"],
  },
  {
    id: "react-props",
    cat: "react",
    title: "Props",
    one: "Read-only inputs passed from parent to child, like function arguments.",
    why: "Without inputs every component would render the same thing. Props make components configurable — the same Badge shows different labels because the parent passes different props.",
    how: "A parent writes <Badge label=\"New\" count={2} />, and the child function receives a single props object. Props are immutable inside the child: to change what renders, the parent passes different props on the next render.",
    when: "Use props for every value a component needs from outside. Don't mutate props or copy them into state — derive what you need during render instead.",
    ref: "React Documentation",
    subtopics: [
      { name: "One-way flow", detail: "Data flows down: parents pass props to children. A child never reaches up to change its parent's data." },
      { name: "children prop", detail: "Content between opening and closing tags arrives as props.children, enabling wrapper components like <Card>...</Card>." },
      { name: "Destructuring", detail: "function Badge({ label, count }) unpacks props in the signature — the dominant convention in modern code." },
    ],
    code: `// @jsx
// Parent passes data down
function App() {
  return <Badge label="New" count={2} />;
}

// Child reads props — read-only!
function Badge({ label, count, children }) {
  // props.label = "x" is illegal; props are immutable
  return (
    <span className="badge">
      {label}: {count}
      {children}
    </span>
  );
}

// children enables wrappers
function Card({ children }) {
  return <div className="card">{children}</div>;
}`,
    steps: ["Parent renders child", "Props passed down", "Child reads props", "Renders output"],
  },
  {
    id: "react-state",
    cat: "react",
    title: "State (useState)",
    one: "Component memory that triggers a re-render when updated via its setter.",
    why: "Regular variables forget their values between renders and never update the UI. State persists across renders, and changing it tells React to re-render and reconcile the DOM.",
    how: "useState(initial) returns a pair: the current value and a setter. Calling the setter schedules a re-render with the new value. Setters are asynchronous in batches — read the fresh value in the next render, not the line after.",
    when: "Use state for values the UI can change (input text, counters, toggles). Don't store derived values or props in state — compute them during render to avoid stale copies.",
    ref: "React Documentation",
    subtopics: [
      { name: "Snapshot behavior", detail: "Each render captures its own state snapshot; handlers from that render see that render's values." },
      { name: "Updater functions", detail: "setCount(c => c + 1) queues an update based on the latest value — required when multiple updates batch." },
      { name: "Objects & arrays", detail: "Replace, never mutate: set_user({ ...user, name: next }) so React detects the change by reference." },
    ],
    code: `const { useState } = require("react");

function Counter() {
  const [count, setCount] = useState(0);

  function increment() {
    // Wrong: both calls see the same stale count
    // setCount(count + 1); setCount(count + 1);

    // Right: updater functions queue correctly
    setCount((c) => c + 1);
    setCount((c) => c + 1); // count is now +2
  }

  return { count, increment }; // render reads count
}`,
    steps: ["useState declares state", "Initial render shows value", "Setter called", "Re-render with new value"],
  },
  {
    id: "react-hooks-rules",
    cat: "react",
    title: "Rules of Hooks",
    one: "Hooks must run unconditionally at the top level, in the same order every render.",
    why: "React associates hook state with call order, not names. A hook inside an if or loop can shift position between renders, so React would hand the wrong state to the wrong hook.",
    how: "Call hooks only at the top level of a component or custom hook — never inside conditions, loops, or nested functions. The linter plugin (eslint-plugin-react-hooks) enforces this mechanically.",
    when: "Apply whenever you write any hook. Conditional logic goes inside the hook (e.g. inside useEffect's body) or around the rendered output — never around the hook call itself.",
    ref: "React Documentation",
    subtopics: [
      { name: "Order-based memory", detail: "React stores hook state in a linked list keyed by call order; that is why reordering hooks breaks state." },
      { name: "The one exception", detail: "The use() API (React 19) may be called conditionally — it is the only hook-like API allowed inside if blocks." },
      { name: "Lint enforcement", detail: "eslint-plugin-react-hooks flags violations at build time; it ships with most frameworks by default." },
    ],
    code: `function Search({ enabled }) {
  // WRONG: hook inside a condition — order can shift
  // if (enabled) { const [q, setQ] = useState(""); }

  // RIGHT: always call, condition inside
  const [q, setQ] = useState("");

  if (!enabled) return null;
  return { q, setQ }; // component body (simplified)
}`,
    steps: ["Render N: hooks run in order", "Render N+1: same order", "State matched by position", "UI stays consistent"],
  },
  {
    id: "react-lists-keys",
    cat: "react",
    title: "Rendering Lists & Keys",
    one: "Map arrays to elements, giving each a stable key so React tracks identity.",
    why: "When a list reorders or an item is removed, React must know which element is which. Without stable keys it may reuse the wrong DOM nodes — scrambling inputs or losing focus.",
    how: "Call .map() over your data returning JSX, and pass a key that uniquely identifies each item among its siblings (a database id). React uses keys to match old and new elements between renders.",
    when: "Always key mapped lists. Use stable data ids — never the array index, unless the list never reorders, filters, or inserts in the middle.",
    ref: "React Documentation",
    subtopics: [
      { name: "Index pitfall", detail: "With index keys, deleting item 2 shifts every later key, so React wrongly reuses DOM and state across rows." },
      { name: "Keys are sibling-scoped", detail: "A key only needs to be unique within its own list, not across the whole app." },
      { name: "Filter + map chain", detail: "Compose searches as data.filter(match).map(render) — a pure pipeline that React re-runs on every render." },
    ],
    code: `// @jsx
const todos = [
  { id: "t1", text: "Ship atlas" },
  { id: "t2", text: "Write tests" },
];

function TodoList() {
  return (
    <ul>
      {todos.map((todo) => (
        // stable id, not array index
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}`,
    steps: ["Array of data", "Map to elements", "Each keyed by id", "React diffs by key", "DOM updated"],
  },
  {
    id: "react-conditional",
    cat: "react",
    title: "Conditional Rendering",
    one: "Show different UI by returning different JSX based on JavaScript conditions.",
    why: "UIs constantly branch — logged in vs out, loading vs loaded, empty vs full. Since JSX is JavaScript, the language's own conditionals do the job with no template syntax to learn.",
    how: "Use ternaries for either/or, && for render-or-nothing, early returns for whole branches, and a variable holding the element when a branch is reused. false and undefined render nothing; 0 renders as text — the classic && bug.",
    when: "Use && only when the left side is truly boolean (or use x ? ... : null). Prefer early returns when a component's whole output changes shape.",
    ref: "React Documentation",
    subtopics: [
      { name: "Ternary", detail: "{isLogged ? <Dashboard /> : <Login />} — the clearest form for two branches." },
      { name: "Guard against 0", detail: "{items.length && <List />} renders a literal 0 when empty; use items.length > 0 &&." },
      { name: "Early return", detail: "if (!data) return <Spinner />; before the main return keeps deep nesting out of JSX." },
    ],
    code: `// @jsx
function Notice({ count, loading }) {
  if (loading) return <Spinner />;

  return (
    <div>
      {/* && with a real boolean */}
      {count > 0 && <p>{count} new</p>}

      {/* ternary for either/or */}
      {count === 0 ? <p>All caught up</p> : <List n={count} />}
    </div>
  );
}`,
    steps: ["Condition evaluated", "Branch selected", "JSX returned", "DOM matches state"],
  },
  {
    id: "react-events",
    cat: "react",
    title: "Event Handling",
    one: "Functions passed as props like onClick, firing on user interaction.",
    why: "Interactive UIs respond to clicks, typing, and submits. React unifies these behind cross-browser synthetic events, so one handler style works everywhere.",
    how: "Pass a function to an event prop: <button onClick={handleClick}>. React attaches listeners at the root and dispatches to your handler with a SyntheticEvent. Handlers defined during a render close over that render's state snapshot.",
    when: "Define handlers inside the component to capture props and state. Don't call the handler in JSX — onClick={fn}, never onClick={fn()}, which fires during render.",
    ref: "React Documentation",
    subtopics: [
      { name: "Arrow vs reference", detail: "onClick={fn} passes the function; onClick={() => fn(id)} wraps it when you need to pass arguments." },
      { name: "preventDefault", detail: "React events don't bubble natively across documents; call e.preventDefault() to stop default browser actions like form submits." },
      { name: "Stale closures", detail: "A handler sees the state snapshot from its render; use updater functions or refs for always-fresh values." },
    ],
    code: `// @jsx
function Signup() {
  const [email, setEmail] = useState("");

  // defined inline: closes over this render's state
  function handleSubmit(e) {
    e.preventDefault(); // stop full-page reload
    subscribe(email);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Join</button>
    </form>
  );
}`,
    steps: ["User interacts", "React dispatches event", "Handler runs with state", "setState triggers re-render"],
  },
  {
    id: "react-useeffect",
    cat: "react",
    title: "useEffect & Side Effects",
    one: "Runs code after render to sync with external systems, with optional cleanup.",
    why: "Rendering must stay pure — no timers, subscriptions, or network writes. useEffect is the escape hatch that lets your component synchronize with the outside world after it paints.",
    how: "useEffect(fn, deps) runs after the commit. The deps array decides when it re-runs: [] once after mount, [id] whenever id changes, nothing on every render. Return a cleanup function and React runs it before the next effect and on unmount.",
    when: "Use it for subscriptions, timers, analytics, and manual DOM/widget sync. Don't use it to derive state, handle events, or transform data for rendering — do that during render or in handlers.",
    ref: "React Documentation",
    subtopics: [
      { name: "Dependency array", detail: "Effect re-runs when any dep changes (Object.is compare); an omitted array re-runs after every render." },
      { name: "Cleanup", detail: "The returned function tears down the previous effect — cancel fetches, clear timers, unsubscribe." },
      { name: "Not a lifecycle", detail: "Think 'synchronization', not componentDidMount; effects re-run as often as their dependencies demand." },
    ],
    code: `const { useEffect, useState } = require("react");

function ChatRoom({ roomId }) {
  const [status, setStatus] = useState("offline");

  useEffect(() => {
    const conn = createConnection(roomId);
    conn.onStatus = setStatus;
    conn.connect();

    return () => conn.disconnect(); // cleanup on change/unmount
  }, [roomId]); // re-runs when roomId changes
}`,
    steps: ["Render commits", "Effect runs after paint", "Deps change?", "Cleanup then re-run", "Unmount: cleanup"],
  },
  {
    id: "react-useref",
    cat: "react",
    title: "useRef & the DOM",
    one: "A mutable box that persists across renders without triggering re-renders.",
    why: "Sometimes you need a value that survives renders but isn't UI state: a DOM node to focus, a timer id, a 'previous value'. Storing those in state would cause pointless re-renders.",
    how: "useRef(initial) returns { current: initial }, the same object on every render. Mutating .current is invisible to React. Attach a ref to JSX (ref={inputRef}) and React fills .current with the DOM node after commit.",
    when: "Use refs for DOM access and mutable non-render data (timer ids, latest-value caches). If a value's change should update the UI, it belongs in state, not a ref.",
    ref: "React Documentation",
    subtopics: [
      { name: "Ref vs state", detail: "State: re-render on change, read during render. Ref: silent mutation, read in handlers and effects." },
      { name: "DOM refs", detail: "React sets ref.current after commit and nulls it on unmount — read it in effects/handlers, not during render." },
      { name: "Latest-value pattern", detail: "Keep a ref synced with state so timers and callbacks always read fresh values without re-subscribing." },
    ],
    code: `const { useRef, useEffect } = require("react");

function Autofocus() {
  const inputRef = useRef(null);

  useEffect(() => {
    // ref.current now holds the real DOM node
    inputRef.current.focus();
  }, []);

  return { input: inputRef }; // <input ref={inputRef} />
}`,
    steps: ["useRef creates box", "Attached to element", "React fills .current", "Imperative access"],
  },
  {
    id: "react-context",
    cat: "react",
    title: "useContext",
    one: "Reads values provided by an ancestor, skipping explicit prop threading.",
    why: "Passing theme or current-user props through five wrapper layers ('prop drilling') couples every layer to data it doesn't care about. Context broadcasts values down the whole subtree.",
    how: "createContext(default) makes a context. A Provider wraps a subtree and supplies a value; any descendant calls useContext(Ctx) to read the nearest provider's value. All consumers re-render when the value changes.",
    when: "Use for low-frequency, app-wide data: theme, locale, auth user. Don't use it for high-frequency updates or as a global state store — every consumer re-renders on each change.",
    ref: "React Documentation",
    subtopics: [
      { name: "Provider scoping", detail: "useContext reads the nearest Provider above in the tree; parts of the app can use different values." },
      { name: "Value identity", detail: "A new object every render re-renders all consumers — memoize the value with useMemo when the provider re-renders often." },
      { name: "Create per concern", detail: "Separate ThemeContext, UserContext, LocaleContext — one mega-context makes every consumer rerender together." },
    ],
    code: `const { createContext, useContext } = require("react");

const ThemeContext = createContext("light");

// Somewhere high in the tree:
// <ThemeContext.Provider value="dark">...</ThemeContext.Provider>

function Button() {
  const theme = useContext(ThemeContext); // "dark"
  return { className: "btn-" + theme };
}`,
    steps: ["createContext", "Provider wraps tree", "Descendant calls useContext", "Nearest value returned"],
  },
  {
    id: "react-usereducer",
    cat: "react",
    title: "useReducer",
    one: "State updates centralized into a pure reducer handling dispatched actions.",
    why: "When one state has many update paths (forms, wizards, undo), scattered setters hide the transitions. A reducer lists every action in one pure function you can test without React.",
    how: "useReducer(reducer, initial) returns [state, dispatch]. Handlers dispatch action objects; React calls reducer(state, action) to produce the next state. Reducers must be pure — same input, same output, no side effects.",
    when: "Use for multi-field state, interdependent transitions, or complex update logic. Reach for useState first — most components don't need a reducer.",
    ref: "React Documentation",
    subtopics: [
      { name: "Actions", detail: "Plain objects { type, payload } describing what happened, not how to mutate — the reducer decides the transition." },
      { name: "Purity", detail: "No fetches, dates, or Math.random in the reducer; React may call it twice in StrictMode to surface impurity." },
      { name: "Predictability", detail: "All transitions visible in one place makes illegal states and missed cases obvious — pair with unit tests." },
    ],
    code: `const { useReducer } = require("react");

function reducer(state, action) {
  switch (action.type) {
    case "added":
      return { ...state, items: [...state.items, action.item] };
    case "removed":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    default:
      throw Error("Unknown action: " + action.type);
  }
}

function Cart() {
  const [state, dispatch] = useReducer(reducer, { items: [] });
  const remove = (id) => dispatch({ type: "removed", id });
  return { state, remove };
}`,
    steps: ["Event fires", "dispatch(action)", "Reducer computes next", "Re-render with new state"],
  },
  {
    id: "react-usememo",
    cat: "react",
    title: "useMemo",
    one: "Caches an expensive computation between renders until dependencies change.",
    why: "Recomputing heavy filters, sorts, or derivations on every render — even ones caused by unrelated state — wastes work. useMemo keeps the last result while its inputs are unchanged.",
    how: "useMemo(() => compute(a, b), [a, b]) runs compute during render and returns the cached value. React re-runs it only when a dependency changes by Object.is. It is a cache, not a guarantee — React may discard it.",
    when: "Use for genuinely expensive calculations or to stabilize object identities passed to memoized children and context values. Don't sprinkle it on trivial expressions — caching costs more than it saves.",
    ref: "React Documentation",
    subtopics: [
      { name: "Measure first", detail: "Profile before memoizing; a 20-item sort is cheaper than the memo bookkeeping." },
      { name: "Dependency rules", detail: "List every reactive value used inside; exhaustive-deps lint keeps the cache honest." },
      { name: "Skip the render", detail: "The related memo() wraps components; useMemo memoizes values. Together they stop subtree re-renders." },
    ],
    code: `const { useMemo, useState } = require("react");

function ProductGrid({ products }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () => products.filter((p) => matches(p, query)).sort(byRank),
    [products, query] // recompute only when these change
  );

  return { visible, setQuery }; // render visible (simplified)
}`,
    steps: ["Render begins", "Deps unchanged?", "Return cached value", "Deps changed: recompute"],
  },
  {
    id: "react-usecallback",
    cat: "react",
    title: "useCallback",
    one: "Keeps a function identity stable between renders until dependencies change.",
    why: "Every render creates new function instances. A memoized child that receives a fresh onClick each time re-renders anyway — the memo is useless. useCallback pins the function identity.",
    how: "useCallback(fn, deps) returns the same function reference while deps are equal; it is useMemo for functions. Combine with memo() on the child so reference equality short-circuits re-renders.",
    when: "Use when passing handlers to memoized components, dependent siblings, or as a stable dependency of another hook. Plain components don't need it — new identities there are harmless.",
    ref: "React Documentation",
    subtopics: [
      { name: "Pairs with memo", detail: "useCallback on the parent + memo on the child is the combo; either alone usually does nothing." },
      { name: "Stable deps", detail: "The deps array works like useMemo's; a dep that changes every render defeats the cache." },
      { name: "Event handlers in effects", detail: "Effects subscribing to handlers stay stable when the handler is wrapped, avoiding tear-down/re-subscribe loops." },
    ],
    code: `const { useCallback, memo } = require("react");

// Child only re-renders when props change by reference
const Row = memo(function Row({ onSelect }) {
  return { onSelect }; // renders row (simplified)
});

function List({ items }) {
  // same function identity across renders
  const handleSelect = useCallback((id) => {
    select(id);
  }, []);

  return items.map((i) => ({ row: i, onSelect: handleSelect }));
}`,
    steps: ["Render creates fn", "useCallback caches it", "Child memo compares refs", "Equal ref: skip re-render"],
  },
  {
    id: "react-custom-hooks",
    cat: "react",
    title: "Custom Hooks",
    one: "Functions named useX that compose built-in hooks into reusable logic.",
    why: "Two components need the same online-status or window-size logic. Custom hooks share stateful behavior between components without adding wrapper components or changing the tree.",
    how: "A custom hook is any function whose name starts with use and which calls other hooks. Each component calling it gets its own isolated state — hooks are shared logic, not shared instances.",
    when: "Extract when the same stateful pattern appears twice, or to keep components readable by naming a concept (useDebounce, useMediaQuery). Don't force a hook around logic that has no state.",
    ref: "React Documentation",
    subtopics: [
      { name: "Isolated per caller", detail: "Each component's call runs its own hooks; state is per component, logic is what's shared." },
      { name: "Compose freely", detail: "Custom hooks call other custom hooks; the Rules of Hooks apply identically inside them." },
      { name: "Return plain values", detail: "Return arrays like useState or objects with named fields — whatever reads best at call sites." },
    ],
    code: `const { useState, useEffect } = require("react");

// Reusable stateful logic — name starts with "use"
function useOnline() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}

// Every caller gets its own subscription & state
// const online = useOnline();`,
    steps: ["Extract pattern", "Name starts with use", "Call built-in hooks", "Each caller isolated"],
  },
  {
    id: "react-controlled-forms",
    cat: "react",
    title: "Controlled Forms",
    one: "Inputs whose value lives in React state, updated through onChange.",
    why: "Uncontrolled inputs keep their truth inside the DOM, invisible to React. Controlled inputs make state the single source of truth, enabling validation, formatting, and conditional UI as the user types.",
    how: "Set value={state} and onChange={(e) => setState(e.target.value)}. Every keystroke updates state, React re-renders, and the input shows the state — a closed loop where the DOM is just a view.",
    when: "Control inputs when you need instant validation, disabling submits, or derived fields. For huge forms or simple file inputs, uncontrolled refs cut re-render churn.",
    ref: "React Documentation",
    subtopics: [
      { name: "Single source of truth", detail: "State drives the input; the DOM never owns the value, so resets and previews are trivial." },
      { name: "Derived validation", detail: "Compute isValid = email.includes('@') during render — no duplicate state to fall out of sync." },
      { name: "Uncontrolled escape hatch", detail: "<input ref> + defaultValue hands truth to the DOM; use for file inputs or perf-critical giants." },
    ],
    code: `// @jsx
function Signup() {
  const [email, setEmail] = useState("");

  const valid = email.includes("@"); // derived, not stored

  return (
    <form>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button disabled={!valid}>Continue</button>
    </form>
  );
}`,
    steps: ["Keystroke fires onChange", "setState updates value", "Re-render with input", "UI derives from state"],
  },
  {
    id: "react-lifting",
    cat: "react",
    title: "Lifting State Up",
    one: "Move shared state to the closest common parent of the components needing it.",
    why: "Two children must show the same data (input + list, temperature scales). Duplicating state in both invites divergence; the shared truth must live above both and flow down as props.",
    how: "Identify the nearest common ancestor, move the useState there, and pass the value plus setter down. Children become 'controlled' by the parent — they display props and call the setter to request changes.",
    when: "Lift when state must sync across siblings. If a single component uses it, keep it local; don't hoist everything to the top — that recreates prop drilling.",
    ref: "React Documentation",
    subtopics: [
      { name: "Single source of truth", detail: "One owner renders two consistent views; the 'duplicated' state becomes derived props." },
      { name: "Controlled children", detail: "A child whose value and onChange both come from props is controlled — same idea as controlled inputs." },
      { name: "Downshift later", detail: "If prop chains grow long, colocate with context or component composition instead of lifting to the app root." },
    ],
    code: `// @jsx
function Converter() {
  // lives here: closest common parent
  const [celsius, setCelsius] = useState("");
  const fahrenheit = celsius === "" ? "" : (celsius * 9) / 5 + 32;

  return (
    <>
      <Scale value={celsius} onChange={setCelsius} label="C" />
      {/* derived sibling stays in sync automatically */}
      <Scale value={fahrenheit} onChange={(v) => setCelsius(((v - 32) * 5) / 9)} label="F" />
    </>
  );
}`,
    steps: ["Two siblings need state", "Find common parent", "Move state up", "Pass value + setter down"],
  },
  {
    id: "react-composition",
    cat: "react",
    title: "Composition over Inheritance",
    one: "Build complex components by combining children and slots, not class hierarchies.",
    why: "Deep inheritance couples components to fragile base classes. Composition lets you rearrange behavior like LEGO — passing markup, components, and render logic as props keeps each piece independent.",
    how: "Use props.children for content, component props for slots (<Card footer={<Actions />} />), and render props or custom hooks to share behavior. React deliberately offers no inheritance mechanism beyond extends for error boundaries.",
    when: "Compose whenever two components differ by structure or behavior. Reach for wrapping/slots instead of a 'base component' you subclass and override.",
    ref: "React Documentation",
    subtopics: [
      { name: "children prop", detail: "The simplest slot: whatever the caller nests inside the tag becomes props.children." },
      { name: "Slot props", detail: "Pass components or elements as props (left, footer, icon) for multiple insertion points." },
      { name: "Hooks over HOCs", detail: "Reusable behavior moved from higher-order components to custom hooks — flatter trees, easier typing." },
    ],
    code: `// @jsx
// Slots via children + component props — no inheritance
function Modal({ title, children, footer }) {
  return (
    <div className="modal">
      <h2>{title}</h2>
      <div className="body">{children}</div>
      <div className="footer">{footer}</div>
    </div>
  );
}

// Callers compose any content in
function Example() {
  return (
    <Modal title="Confirm" footer={<CancelButton />}>
      <p>Are you sure?</p>
    </Modal>
  );
}`,
    steps: ["Identify variable parts", "Expose them as slots", "Callers compose", "One flexible component"],
  },
  {
    id: "react-suspense",
    cat: "react",
    title: "Suspense",
    one: "Declares a loading fallback while children wait for data or code.",
    why: "Showing a spinner for the whole page because one widget awaits data makes every screen feel slow. Suspense lets each slow region declare its own fallback and stream in independently.",
    how: "Wrap a slow child in <Suspense fallback={<Skeleton />}>. When the child suspends (async server component, lazy-loaded bundle, or a promise read with use()), React shows the fallback and swaps in content when ready.",
    when: "Wrap route-level data fetches and lazy components. Keep fallbacks skeleton-shaped to avoid layout shift; don't wrap tiny inline reads where the flicker costs more than the wait.",
    ref: "React Documentation",
    subtopics: [
      { name: "Granular fallbacks", detail: "Nested Suspense boundaries isolate slow areas — the shell stays interactive while panels load." },
      { name: "Works with lazy()", detail: "React.lazy code-splitting suspends while the chunk downloads; Suspense supplies the placeholder." },
      { name: "Streaming", detail: "In server rendering, suspended boundaries send their fallback immediately and stream HTML when ready." },
    ],
    code: `// @jsx
const Chart = require("react").lazy(() => loadChart());

function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      {/* shell renders now; chart streams in */}
      <Suspense fallback={<ChartSkeleton />}>
        <Chart />
      </Suspense>
    </div>
  );
}`,
    steps: ["Child suspends", "Fallback shown", "Promise resolves", "Content swapped in"],
  },
  {
    id: "react-error-boundaries",
    cat: "react",
    title: "Error Boundaries",
    one: "Components that catch render errors in their subtree and show a fallback.",
    why: "One broken widget shouldn't blank the whole app. Without a boundary, any render error unmounts the entire tree; with one, the blast radius is the wrapped subtree.",
    how: "A class component defining static getDerivedStateFromError and componentDidCatch becomes a boundary. Wrap risky subtrees in it. Boundaries catch render/lifecycle errors of children — not event handlers or server component errors.",
    when: "Wrap third-party widgets, route segments, and anything fed by unpredictable data. Handle event-handler errors with try/catch inside the handler — boundaries don't see those.",
    ref: "React Documentation",
    subtopics: [
      { name: "Catch scope", detail: "Catch errors in rendering, lifecycle, and constructors of the whole subtree below — the boundary itself is not covered." },
      { name: "Recovery UX", detail: "Fallbacks can offer 'try again' by resetting boundary state — turn a dead page into a retryable panel." },
      { name: "Framework support", detail: "Router frameworks map boundaries to route segments (error.tsx); libraries like react-error-boundary wrap the class for you." },
    ],
    code: `// @jsx
class WidgetBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true }; // re-render with fallback
  }
  componentDidCatch(error, info) {
    logToService(error, info);
  }
  render() {
    if (this.state.failed) return <p>Widget unavailable</p>;
    return this.props.children;
  }
}

// Usage: blast radius limited to the widget
// <WidgetBoundary><ThirdPartyChart /></WidgetBoundary>`,
    steps: ["Child throws", "Boundary catches", "Fallback rendered", "Rest of app survives"],
  },
  {
    id: "react-portals",
    cat: "react",
    title: "Portals",
    one: "Render children into a different DOM node while staying in the React tree.",
    why: "Modals, tooltips, and toasts get clipped by parent overflow or z-index stacking. A portal keeps the component's logic and context in place but renders its DOM elsewhere — usually document.body.",
    how: "createPortal(jsx, containerNode) renders jsx into containerNode. Event bubbling follows the React tree, so a click in the modal still fires handlers of the React parent that rendered it.",
    when: "Use for overlays that must escape their container's CSS: dialogs, dropdowns, tooltips. Not needed when stacking works fine — a portal per tooltip adds cost without benefit.",
    ref: "React Documentation",
    subtopics: [
      { name: "Escapes CSS", detail: "Rendered outside the parent's DOM, overlays dodge overflow: hidden and stacking-context traps." },
      { name: "Context preserved", detail: "The React tree is unchanged: themes and contexts still flow from the component that rendered the portal." },
      { name: "Accessibility duty", detail: "Portals don't manage focus — pair with focus-trap and Escape handling for real dialogs." },
    ],
    code: `// @jsx
const { createPortal } = require("react-dom");

function Modal({ children, onClose }) {
  // DOM renders under body, React tree unchanged
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}`,
    steps: ["Component renders portal", "DOM mounted to target", "Events bubble React-tree", "Overlay escapes CSS"],
  },
  {
    id: "react-reconciliation",
    cat: "react",
    title: "Reconciliation & the Virtual DOM",
    one: "Diffing new and old element trees so only changed DOM nodes update.",
    why: "Rewriting the whole DOM per render would be brutal. React renders to lightweight element trees, diffs them against the previous tree, and touches the real DOM only where output actually changed.",
    how: "On render, React compares new children with old by position and key: same type in the same place reuses and patches the instance; different type unmounts and rebuilds. Keys align items within lists across renders.",
    when: "Understand it to structure lists (stable keys) and component shapes (consistent types). You never call the reconciler directly — but O(n) heuristics explain most 'why did that remount?' puzzles.",
    ref: "React Documentation",
    subtopics: [
      { name: "O(n) heuristic", detail: "Full tree diffing is O(n³); React assumes same-position same-type and keys in lists to make it O(n)." },
      { name: "Same type = patch", detail: "<div className> changing class only mutates the attribute; swapping div for span remounts the subtree." },
      { name: "Remount symptoms", detail: "Losing input focus or animation restarts usually mean type or key identity changed between renders." },
    ],
    code: `// Render 1:  <div className="card">...</div>
// Render 2:  <div className="card open">...</div>
// -> same type: DOM node kept, className patched only

// Render 1:  <div className="card">...</div>
// Render 2:  <span className="card">...</span>
// -> type changed: old subtree unmounted, new mounted

// Lists: keys give items identity across renders
// <li key={todo.id}> — reorder moves, doesn't rebuild`,
    steps: ["State changes", "New element tree built", "Diff vs previous tree", "Minimal DOM mutations"],
  },
  {
    id: "react-rsc",
    cat: "react",
    title: "Server Components",
    one: "Components that render only on the server, shipping zero JS to the browser.",
    why: "Client bundles explode when every component — even static ones — ships to the browser. Server Components run once on the server, can read databases directly, and send only their rendered output.",
    how: "Components are server by default in the App Router. Add 'use client' to opt a file into interactive client rendering (state, effects, browser APIs). A server component can render a client component and pass serializable props down.",
    when: "Keep data-fetching and static sections as server components; carve out the interactive islands as client components. Don't add 'use client' to whole pages — it erases the benefit.",
    ref: "React Documentation",
    subtopics: [
      { name: "'use client' boundary", detail: "The directive marks the entry of a client subtree; everything it imports joins the client bundle." },
      { name: "Serialization limit", detail: "Props crossing the boundary must be serializable — functions and class instances can't cross." },
      { name: "No hooks server-side", detail: "useState/useEffect throw in server components; interactivity belongs behind a 'use client' island." },
    ],
    code: `// @jsx
// Server Component (default) — runs on server only
async function Profile({ userId }) {
  const user = await db.users.find(userId); // direct DB access
  return (
    <section>
      <h1>{user.name}</h1>
      {/* interactive island: client component */}
      <FollowButton initialFollowing={user.following} />
    </section>
  );
}

// FollowButton.tsx starts with: "use client"`,
    steps: ["Request arrives", "Server component runs", "Data fetched server-side", "HTML + islands sent", "Client hydrates islands"],
  },
  {
    id: "react-concurrent",
    cat: "react",
    title: "Concurrent Features",
    one: "useTransition and useDeferredValue keep typing responsive during heavy updates.",
    why: "Filtering a huge list as the user types blocks the input — every keystroke waits for the full re-render. Concurrent rendering marks some updates as non-urgent so the UI stays responsive.",
    how: "useTransition returns [isPending, startTransition]; updates wrapped in startTransition are interruptible and yield to urgent ones (typing, clicks). useDeferredValue(v) renders with the previous value while recomputing the new one in the background.",
    when: "Use for expensive renders triggered by typing or filtering. Skip for quick updates — the machinery adds a render pass that cheap screens don't need.",
    ref: "React Documentation",
    subtopics: [
      { name: "Urgent vs transitional", detail: "Typing, clicks, hover are urgent; resulting list re-renders are transitional and can be interrupted." },
      { name: "isPending UI", detail: "Show dimmed lists or spinners from isPending so stale-but-interactive content reads as updating." },
      { name: "Deferred value", detail: "useDeferredValue needs no access to the setter — handy when the value arrives via props." },
    ],
    code: `const { useState, useTransition } = require("react");

function Search({ bigList }) {
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  function onChange(e) {
    setQuery(e.target.value); // urgent: input updates now
    startTransition(() => {
      // non-urgent: heavy filter can be interrupted
      applyFilter(bigList, e.target.value);
    });
  }

  return { onChange, isPending, opacity: isPending ? 0.6 : 1 };
}`,
    steps: ["Urgent update renders", "startTransition queued", "Input stays responsive", "Heavy render completes"],
  },
  {
    id: "react-state-libs",
    cat: "react",
    title: "External State Management",
    one: "Stores like Redux or Zustand hold shared app state outside the component tree.",
    why: "Lifting state and context solve most sharing, but giant cross-page state (carts, auth, undo history) can outgrow them. External stores give any component direct access without prop chains or provider re-render storms.",
    how: "A store lives outside React; components subscribe to slices. Zustand reads with a selector hook (no providers); Redux wraps the app in a Provider and dispatches actions through reducers. Both re-render only components whose selected slice changed.",
    when: "Adopt when server-cache and context clearly aren't enough — heavy cross-tree state with frequent updates. Skip for local UI state; a store for modal open booleans is pure overhead.",
    ref: "Redux Documentation",
    subtopics: [
      { name: "Zustand style", detail: "create(set => ({ count: 0, inc: () => set(s => ({ count: s.count + 1 })) })) — one store, selector hooks, no providers." },
      { name: "Redux style", detail: "Actions → reducers → store with strict devtools/time-travel; verbose but maximally traceable." },
      { name: "Server state first", detail: "TanStack Query/similar already cache API data; reach for a store for client-owned state, not fetched copies." },
    ],
    code: `// Zustand-style store (plain JS sketch)
function createStore(createState) {
  let state = createState(setState);
  const listeners = new Set();

  function setState(partial) {
    state = { ...state, ...partial };
    listeners.forEach((l) => l());
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function getState() {
    return state;
  }
  return { getState, setState, subscribe };
}

const store = createStore((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

// Any component: store.getState().count, store.getState().inc()`,
    steps: ["Store created", "Components subscribe", "Action mutates store", "Subscribers re-render"],
  },
];
