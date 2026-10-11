# Agent eval cases

`cases.json` is a small, repeatable challenge set for Tyox's coding loop. It covers new-project generation, a multi-turn edit, a multi-component page, Q&A resume, and preview recovery.

## How to run the cases

These cases are currently run manually; there is no model-driven eval runner yet. For each case:

1. Start Tyox and create the setup described by the case. Use a fresh sandbox unless the case explicitly needs one conversation across turns.
2. Send each prompt in order. For a Q&A case, answer the agent's question and continue in the same conversation.
3. Check every acceptance item. Review the actual preview and run output as well as the generated app's tests and build; tests written by the agent are useful checks, but are not independent evidence on their own.
4. Save the `agent_run_summary` log line for each request beside the case ID. Compare outcome, validation, preview, latency, token counts, and repair attempts between runs.

Keep the prompts and acceptance criteria fixed when comparing a model or system-prompt change. A case passes only when all its acceptance items pass. Record qualitative visual judgments separately instead of turning them into a made-up precise score.
