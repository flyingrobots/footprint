# footprint documentation

| Page | Job |
| --- | --- |
| [Composition](topics/composition/README.md) | What the composition report measures and how to read it |
| [Composition test plan](topics/composition/test-plan.md) | Requirements and evidence |
| [Landing](topics/landing/README.md) | What footprint reads to say how a change lands, and the guard rule behind the unguarded-change warning |
| [Blast radius](topics/blast-radius/README.md) | What the export-surface diff lists, which graft contract the symbols come from, and how the call sites are found |
| [Overlap](topics/overlap/README.md) | Cross-pull-request overlap: the conflict graph, the merge waves, and what `gh` is asked. Its requirements are OUT-8 in the output test plan |
| [Output](topics/output/README.md) | What a caller receives: JSON Lines, the receipt, `--human`, errors, discovery, exit status |
| [Output test plan](topics/output/test-plan.md) | Requirements and evidence for the output contract, including the overlap result |

| Elsewhere | Job |
| --- | --- |
| [`README.md`](../README.md) | Front door |
| [`AGENTS.md`](../AGENTS.md) | Working agreement |
| [`CHANGELOG.md`](../CHANGELOG.md) | Release-visible history |

Living references describe behavior on `main`. Nothing is archived; git history is the archive.
