import fs from "fs";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
const traverse = traverseModule.default || traverseModule;

const src = fs.readFileSync("src/CustomStats.jsx", "utf8");
const ast = parse(src, { sourceType: "module", plugins: ["jsx"] });

let problems = [];

traverse(ast, {
  CallExpression(path) {
    if (path.node.callee.type !== "Identifier" || path.node.callee.name !== "t") return;
    // Resolve the binding for this "t" identifier at this call site
    const binding = path.scope.getBinding("t");
    if (!binding) {
      problems.push({ line: path.node.loc.start.line, issue: "NO BINDING (undefined t)" });
      return;
    }
    // Check if binding comes from the top-level import (i18n.js) vs a local param/var
    if (binding.kind !== "module") {
      problems.push({
        line: path.node.loc.start.line,
        issue: `t is shadowed by local ${binding.kind} (declared at line ${binding.path.node.loc?.start.line})`,
      });
    }
  },
});

if (problems.length === 0) {
  console.log("OK: no shadowing issues found across all t(...) call sites.");
} else {
  console.log(`FOUND ${problems.length} ISSUES:`);
  problems.forEach((p) => console.log(`  line ${p.line}: ${p.issue}`));
}
