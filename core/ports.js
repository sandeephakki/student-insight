// Ports: late-bound function slots for UPWARD calls between modules.
//
// WHY: core/ui modules call each other in both directions (state-nav -> renders,
// renders -> goStep, ...). Static imports in both directions form an ES-module
// cycle (TDZ crashes, load-order fragility). The module graph is now a strict
// DAG (checked by scripts/check-import-cycles.py): a module may statically import
// only from layers BELOW it; a call to a layer ABOVE goes through a port:
//
//   consumer:  const goStep = port('goStep');           // wrapper, resolved at call time
//   provider:  provide({ goStep, ... });                // at the bottom of the provider
//
// Zero imports on purpose. Providers register while core/main.js evaluates the
// whole graph, i.e. before any user interaction or DOMContentLoaded handler.
const impl = Object.create(null);

function provide(fns) {
  for (const k of Object.keys(fns)) impl[k] = fns[k];
}

function port(name) {
  return function (...args) {
    const fn = impl[name];
    if (typeof fn !== 'function') throw new Error('Port not provided: ' + name + ' (is its provider module loaded via core/main.js?)');
    return fn.apply(this, args);
  };
}

export { provide, port };
