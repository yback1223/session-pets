#!/usr/bin/env python3
"""Best-effort local observer. Never changes a Claude decision or blocks a task."""
import json
import os
import socket
import sys
import uuid

def main():
    try:
        data = sys.stdin.buffer.read(262145)
        if len(data) > 262144:
            return
        raw = json.loads(data)
        # Send only what the pet needs. Prompts, tool inputs and transcripts stay in Claude.
        allowed = ("hook_event_name", "session_id", "prompt_id", "agent_id", "agent_type", "cwd", "last_assistant_message", "notification_type", "tool_name", "tool_use_id", "elicitation_id", "mcp_server_name")
        event = {key: raw[key] for key in allowed if key in raw}
        for key in ("tool_name", "tool_use_id", "elicitation_id", "mcp_server_name"):
            if key in event:
                if not isinstance(event[key], str) or len(event[key]) > 200:
                    event.pop(key)
        event["surface"] = "desktop" if os.environ.get("CLAUDE_CODE_ENTRYPOINT") in ("claude-desktop", "claude-desktop-3p") else "cli"
        event["event_id"] = str(uuid.uuid4())
        if isinstance(event.get("last_assistant_message"), str):
            event["last_assistant_message"] = event["last_assistant_message"][:60000]
        target = os.environ.get("SESSION_PETS_SOCKET", os.path.expanduser("~/Library/Application Support/session-pets/hooks.sock"))
        encoded = json.dumps(event, ensure_ascii=False).encode("utf-8")
        if len(encoded) > 262144:
            return
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(0.6)
            client.connect(target)
            client.sendall(encoded)
    except Exception:
        pass

if __name__ == "__main__":
    main()
