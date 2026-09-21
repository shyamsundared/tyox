fe and code preview ->sse to backend(as of now storing projects in memory,/tmp/project folder inside backend)
backend ->sse to agent, agent then decides what to do with its tools - write file,read file,run bash cmds,edit file.
all the agent response is streamed to backend and backend streams it to frontend.

further it should support two more tool calls -qna,create todos
qna - shoudl be back and forth convo between llm and fe, finally full user convo is sent to llm.
create_todos is essentially the tasks /plan the llm comes up with

