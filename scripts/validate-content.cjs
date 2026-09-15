const fs = require("fs");
const files = ["core", "web", "db", "auth", "arch", "cache", "scale", "ops", "sysd"];
let total = 0;
const issues = [];
for (const f of files) {
  const src = fs.readFileSync("data/concepts/" + f + ".ts", "utf8");
  const ids = (src.match(/\n    id: "/g) || []).length;
  const whys = (src.match(/\n    why: "/g) || []).length;
  const hows = (src.match(/\n    how: "/g) || []).length;
  const whens = (src.match(/\n    when: "/g) || []).length;
  const subs = (src.match(/\n    subtopics: \[/g) || []).length;
  const codes = (src.match(/\n    code: `/g) || []).length;
  const steps = (src.match(/\n    steps: \[/g) || []).length;
  console.log(f + ": ids=" + ids + " why=" + whys + " how=" + hows + " when=" + whens + " sub=" + subs + " code=" + codes + " steps=" + steps);
  total += ids;
  if (ids !== 25 || whys !== 25 || hows !== 25 || whens !== 25 || subs !== 25 || codes !== 25 || steps !== 25) issues.push(f);
}
console.log("TOTAL concepts:", total);
console.log(issues.length ? "ISSUES: " + issues.join(",") : "ALL FILES COMPLETE (25 concepts x 9 fields each)");
