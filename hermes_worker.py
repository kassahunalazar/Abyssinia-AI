"""Run a single tool-free turn using the installed Hermes Agent."""
import contextlib
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

PROMPT = (
    "You are Abyssinia AI (አቢሲኒያ AI), a helpful Ethiopian assistant. Reply in natural, everyday Amharic "
    "by default. Preserve English technical terms where natural. Follow a user's "
    "explicit language choice. Ask for clarification when calendar conventions "
    "or dates are ambiguous. You have no local tools."
)

def main():
    request = json.load(sys.stdin)
    sys.path.insert(0, os.environ["ASSISTANT_HERMES_SOURCE"])
    with contextlib.redirect_stdout(sys.stderr):
        from run_agent import AIAgent

        agent = AIAgent(
            provider="custom",
            base_url=os.environ["ASSISTANT_MODEL_URL"],
            api_key=os.environ.get("ASSISTANT_MODEL_KEY", "local-model"),
            model=os.environ["ASSISTANT_MODEL_ID"],
            enabled_toolsets=[],
            skip_context_files=True,
            skip_memory=True,
            skip_background_review=True,
            ephemeral_system_prompt=PROMPT,
            max_iterations=2,
            max_tokens=1500,
            run_budget_seconds=50,
            quiet_mode=True,
        )
        if getattr(agent, "tools", None) != []:
            raise RuntimeError("Expected an empty Hermes tool list.")
        result = agent.run_conversation(request["message"], conversation_history=request.get("history", []))
    reply = result.get("final_response")
    if result.get("failed") or result.get("partial") or not isinstance(reply, str) or not reply.strip():
        raise RuntimeError("Hermes returned no successful reply.")
    print(json.dumps({"reply": reply}, ensure_ascii=False))

if __name__ == "__main__":
    if os.environ.get("ASSISTANT_TEST_WORKER_LOG") == "1":
        import faulthandler
        faulthandler.dump_traceback_later(20)
    main()
