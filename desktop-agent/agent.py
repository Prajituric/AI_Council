#!/usr/bin/env python3
"""
AI Council Desktop Agent
========================
Runs silently in the background, connects to your AI Council via Supabase
Realtime, and executes computer-use tasks using the Anthropic Claude API.

Setup:
  pip install -r requirements.txt
  cp config.example.env .env
  # Fill in .env values, then:
  python agent.py

How it works:
  1. Connects to Supabase Realtime channel  "desktop:{USER_ID}"
  2. Waits for broadcast messages from the AI Council web app
  3. On receiving a task, starts a Claude Computer Use loop:
       screenshot → Claude sees screen → instructs action → execute → repeat
  4. Reports status and final result back through the same channel
  5. Logs every action locally in agent.log

Security:
  - Every command must carry a valid HMAC-signed auth token (same JWT_SECRET
    as the server). Set AGENT_SECRET to your JWT_SECRET value in .env.
  - Destructive actions (rm -rf, etc.) require confirmation by default.
  - Cancel any running task by clicking Cancel in the web UI.
  - Kill instantly: Ctrl+C or close the terminal window.
"""

import os
import sys
import json
import time
import base64
import hmac
import hashlib
import logging
import asyncio
import platform
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── Dependency check ─────────────────────────────────────────
try:
    import anthropic
    from dotenv import load_dotenv
    import httpx
    import websockets
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip install -r requirements.txt")
    sys.exit(1)

# ── Config ───────────────────────────────────────────────────
load_dotenv()

ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
SUPABASE_URL        = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY   = os.getenv("SUPABASE_ANON_KEY", "")
USER_ID             = os.getenv("AGENT_USER_ID", "default")
AGENT_SECRET        = os.getenv("AGENT_SECRET", "")   # must match JWT_SECRET on server
MAX_STEPS           = int(os.getenv("AGENT_MAX_STEPS", "20"))
CONFIRM_DESTRUCTIVE = os.getenv("AGENT_CONFIRM_DESTRUCTIVE", "true").lower() == "true"

# Token expiry tolerance — 30 days in ms (matches server)
TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("agent.log"),
        logging.StreamHandler(sys.stdout),
    ]
)
log = logging.getLogger("desktop-agent")

# ── Token verification ────────────────────────────────────────
def verify_token(token: str) -> Optional[str]:
    """
    Verify an HMAC-signed auth token (same format as server _auth-check.js).
    Token = base64(userId:timestamp:HMAC-SHA256(JWT_SECRET, userId:timestamp))
    Returns userId on success, None on failure.
    Logs the reason for rejection.
    """
    if not AGENT_SECRET:
        log.warning("[security] AGENT_SECRET not set — all commands accepted (NOT RECOMMENDED)")
        return "unverified"

    if not token:
        log.error("[security] Rejected: no token in command payload")
        return None

    try:
        decoded = base64.b64decode(token.encode()).decode("utf-8")
        parts   = decoded.split(":")
        if len(parts) != 3:
            log.error("[security] Rejected: malformed token (expected 3 parts)")
            return None

        user_id, ts_str, sig = parts

        # Expiry check
        age_ms = int(time.time() * 1000) - int(ts_str)
        if age_ms > TOKEN_MAX_AGE_MS:
            log.error(f"[security] Rejected: token expired ({age_ms // 86400000}d old)")
            return None

        # HMAC re-computation
        payload  = f"{user_id}:{ts_str}"
        expected = hmac.new(
            AGENT_SECRET.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        # Constant-time compare
        if not hmac.compare_digest(sig.encode("utf-8"), expected.encode("utf-8")):
            log.error("[security] Rejected: invalid token signature")
            return None

        log.info(f"[security] Token verified for user: {user_id}")
        return user_id

    except Exception as e:
        log.error(f"[security] Token verification error: {e}")
        return None

# ── Screenshot ───────────────────────────────────────────────
def take_screenshot() -> str:
    """Capture the full screen and return a base64-encoded PNG."""
    system = platform.system()
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        path = f.name

    try:
        if system == "Darwin":
            subprocess.run(["screencapture", "-x", path], check=True, capture_output=True)
        elif system == "Windows":
            ps_script = f"""
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bitmap.Save('{path}')
$graphics.Dispose()
$bitmap.Dispose()
"""
            subprocess.run(["powershell", "-Command", ps_script], check=True, capture_output=True)
        elif system == "Linux":
            for cmd in [
                ["scrot", path],
                ["gnome-screenshot", "-f", path],
                ["import", "-window", "root", path],
            ]:
                try:
                    subprocess.run(cmd, check=True, capture_output=True)
                    break
                except (subprocess.CalledProcessError, FileNotFoundError):
                    continue
        else:
            raise RuntimeError(f"Unsupported OS: {system}")

        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

# ── Input actions ─────────────────────────────────────────────
def execute_action(action: dict) -> str:
    """Execute a computer-use action and return a result string."""
    action_type = action.get("type", "")
    system = platform.system()

    if action_type == "screenshot":
        return "Screenshot captured"

    elif action_type == "mouse_move":
        x, y = action["coordinate"]
        if system == "Darwin":
            subprocess.run(["cliclick", f"m:{x},{y}"], capture_output=True)
        elif system == "Windows":
            ps = f"Add-Type -A 'System.Windows.Forms'; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point({x},{y})"
            subprocess.run(["powershell", "-Command", ps], capture_output=True)
        return f"Mouse moved to ({x}, {y})"

    elif action_type == "left_click":
        x, y = action["coordinate"]
        if system == "Darwin":
            subprocess.run(["cliclick", f"c:{x},{y}"], capture_output=True)
        elif system == "Windows":
            ps = f"""
Add-Type -A 'System.Windows.Forms'
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point({x},{y})
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);' -N U -P W
[W.U]::mouse_event(2,0,0,0,0); [W.U]::mouse_event(4,0,0,0,0)
"""
            subprocess.run(["powershell", "-Command", ps], capture_output=True)
        return f"Clicked at ({x}, {y})"

    elif action_type == "double_click":
        x, y = action["coordinate"]
        if system == "Darwin":
            subprocess.run(["cliclick", f"dc:{x},{y}"], capture_output=True)
        return f"Double-clicked at ({x}, {y})"

    elif action_type == "type":
        text = action.get("text", "")
        if system == "Darwin":
            escaped = text.replace("\\", "\\\\").replace('"', '\\"')
            subprocess.run(["osascript", "-e", f'tell application "System Events" to keystroke "{escaped}"'], capture_output=True)
        elif system == "Windows":
            ps_text = text.replace("'", "''")
            ps = f"Add-Type -A 'System.Windows.Forms'; [System.Windows.Forms.SendKeys]::SendWait('{ps_text}')"
            subprocess.run(["powershell", "-Command", ps], capture_output=True)
        return f"Typed: {text[:50]}{'...' if len(text)>50 else ''}"

    elif action_type == "key":
        key = action.get("text", "")
        if system == "Darwin":
            KEY_MAP = {
                "Return": "return", "Enter": "return", "Tab": "tab",
                "Escape": "escape", "ctrl+c": "c", "ctrl+v": "v",
                "ctrl+z": "z", "ctrl+a": "a",
            }
            mapped = KEY_MAP.get(key, key)
            subprocess.run(["osascript", "-e", f'tell application "System Events" to keystroke "{mapped}"'], capture_output=True)
        return f"Key pressed: {key}"

    elif action_type == "scroll":
        x, y = action["coordinate"]
        direction = action.get("direction", "down")
        amount    = action.get("amount", 3)
        if system == "Darwin":
            delta = -amount if direction == "down" else amount
            subprocess.run(["cliclick", f"m:{x},{y}"], capture_output=True)
            subprocess.run(["osascript", "-e", f'tell application "System Events" to scroll {delta} of {direction}'], capture_output=True)
        return f"Scrolled {direction} at ({x}, {y})"

    elif action_type == "bash":
        cmd = action.get("command", "")
        DESTRUCTIVE_PATTERNS = ["rm -rf", "rmdir /s", "del /f", "format ", "mkfs", "> /dev/"]
        if CONFIRM_DESTRUCTIVE and any(p in cmd for p in DESTRUCTIVE_PATTERNS):
            confirm = input(f"\n⚠️  Destructive command:\n  {cmd}\nConfirm? (yes/no): ").strip()
            if confirm.lower() != "yes":
                return "Command cancelled by user"
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=30
            )
            output = (result.stdout + result.stderr).strip()
            return output[:2000] if output else "(no output)"
        except subprocess.TimeoutExpired:
            return "Command timed out after 30s"
        except Exception as e:
            return f"Command error: {e}"

    elif action_type == "str_replace_editor":
        command   = action.get("command", "")
        path_str  = action.get("path", "")
        file_path = Path(path_str).expanduser()

        if command == "view":
            if file_path.is_file():
                return file_path.read_text(errors="replace")[:3000]
            elif file_path.is_dir():
                items = list(file_path.iterdir())[:50]
                return "\n".join(str(i.name) + ("/" if i.is_dir() else "") for i in items)
            return f"Path not found: {path_str}"

        elif command == "create":
            file_text = action.get("file_text", "")
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(file_text)
            return f"Created: {path_str}"

        elif command == "str_replace":
            old     = action.get("old_str", "")
            new     = action.get("new_str", "")
            content = file_path.read_text(errors="replace")
            if old not in content:
                return f"String not found in {path_str}"
            file_path.write_text(content.replace(old, new, 1))
            return f"Replaced in: {path_str}"

    return f"Unknown action: {action_type}"

# ── Claude Computer Use loop ──────────────────────────────────
async def run_computer_use_task(
    task: str,
    broadcast_fn,
    cancel_flag: asyncio.Event,
) -> str:
    """
    Execute a task using the Claude Computer Use loop.
    Loops: screenshot → Claude → action → screenshot → … until done/max steps/cancelled.
    cancel_flag: asyncio.Event — set it to request clean cancellation.
    """
    if not ANTHROPIC_API_KEY:
        return "Error: ANTHROPIC_API_KEY not set in .env"

    client   = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    messages = []
    step     = 0

    tools = [
        {
            "type": "computer_20241022",
            "name": "computer",
            "display_width_px": 1920,
            "display_height_px": 1080,
            "display_number": 1,
        },
        {"type": "bash_20241022",        "name": "bash"},
        {"type": "text_editor_20241022", "name": "str_replace_editor"},
    ]

    system_prompt = """You are an AI agent with full control of a desktop computer.
You must complete the user's task efficiently and safely.

Guidelines:
- Take a screenshot first to see the current state of the screen
- Prefer keyboard shortcuts over clicking when possible
- Confirm your understanding before destructive operations
- Report progress clearly
- When the task is complete, end with: TASK_COMPLETE: [summary of what was done]
"""

    messages.append({
        "role": "user",
        "content": (
            f"Please complete this task: {task}\n\n"
            "Start by taking a screenshot to see the current state of the screen."
        ),
    })

    await broadcast_fn({"status": "running", "step": f"Starting task: {task[:80]}"})

    while step < MAX_STEPS:
        # ── Cancellation check ─────────────────────────────────
        if cancel_flag.is_set():
            log.info("[CU loop] Task cancelled by user request")
            return "Cancelled"

        step += 1
        log.info(f"[CU loop] Step {step}/{MAX_STEPS}")

        try:
            response = client.beta.messages.create(
                model="claude-opus-4-5",
                max_tokens=4096,
                tools=tools,
                messages=messages,
                betas=["computer-use-2024-10-22"],
                system=system_prompt,
            )
        except Exception as e:
            log.error(f"[CU loop] API error: {e}")
            return f"API error: {e}"

        tool_calls   = []
        text_content = []

        for block in response.content:
            if block.type == "text":
                text_content.append(block.text)
                log.info(f"[CU] Claude: {block.text[:200]}")
                if "TASK_COMPLETE:" in block.text:
                    completion_msg = block.text.split("TASK_COMPLETE:")[-1].strip()
                    await broadcast_fn({"status": "done", "step": "Task complete", "result": completion_msg})
                    return completion_msg
            elif block.type == "tool_use":
                tool_calls.append(block)

        if not tool_calls:
            final_text = "\n".join(text_content)
            await broadcast_fn({"status": "done", "step": "Task complete", "result": final_text[:500]})
            return final_text

        if response.stop_reason == "end_turn" and not tool_calls:
            break

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for tool_call in tool_calls:
            # ── Per-tool cancellation check ────────────────────
            if cancel_flag.is_set():
                log.info("[CU loop] Task cancelled mid-step")
                return "Cancelled"

            log.info(f"[CU] Tool: {tool_call.name} — {json.dumps(tool_call.input)[:200]}")

            if tool_call.name == "computer":
                action      = tool_call.input
                action_type = action.get("action", action.get("type", ""))

                if action_type == "screenshot":
                    try:
                        screenshot_b64 = take_screenshot()
                        tool_result_content = [{
                            "type": "image",
                            "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64},
                        }]
                        await broadcast_fn({
                            "status": "step",
                            "step": f"Screenshot taken (step {step})",
                            "stepNumber": step,
                            "screenshot": screenshot_b64,
                        })
                    except Exception as e:
                        tool_result_content = [{"type": "text", "text": f"Screenshot failed: {e}"}]
                else:
                    result = execute_action({"type": action_type, **action})
                    tool_result_content = [{"type": "text", "text": result}]
                    log.info(f"[CU] Action result: {result[:100]}")
                    await broadcast_fn({
                        "status": "step",
                        "step": f"Step {step}: {result[:80]}",
                        "stepNumber": step,
                    })

            elif tool_call.name == "bash":
                result = execute_action({"type": "bash", "command": tool_call.input.get("command", "")})
                tool_result_content = [{"type": "text", "text": result}]
                await broadcast_fn({"status": "step", "step": f"Shell: {result[:80]}", "stepNumber": step})

            elif tool_call.name == "str_replace_editor":
                result = execute_action({"type": "str_replace_editor", **tool_call.input})
                tool_result_content = [{"type": "text", "text": result}]
                await broadcast_fn({"status": "step", "step": f"File: {result[:80]}", "stepNumber": step})

            else:
                tool_result_content = [{"type": "text", "text": f"Unknown tool: {tool_call.name}"}]

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tool_call.id,
                "content": tool_result_content,
            })

        messages.append({"role": "user", "content": tool_results})

    last = text_content[-1][:200] if text_content else "unknown"
    return f"Reached {MAX_STEPS}-step limit. Last: {last}"

# ── Supabase Realtime client ──────────────────────────────────
class RealtimeAgent:
    """
    Connects to Supabase Realtime WebSocket, listens for desktop commands,
    and handles cancel requests. Channel: desktop:{USER_ID}
    """

    def __init__(self):
        self.channel      = f"desktop:{USER_ID}"
        self.ws_url       = self._build_ws_url()
        self.ws           = None
        self.ref          = 0
        self.running      = False
        # Maps requestId → asyncio.Event; set the event to cancel that task
        self._cancel_flags: dict[str, asyncio.Event] = {}

    def _build_ws_url(self):
        base = SUPABASE_URL.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
        return f"{base}/realtime/v1/websocket?apikey={SUPABASE_ANON_KEY}&vsn=1.0.0"

    def _next_ref(self):
        self.ref += 1
        return str(self.ref)

    async def send(self, msg: dict):
        if self.ws:
            await self.ws.send(json.dumps(msg))

    async def broadcast(self, payload: dict):
        """Send a broadcast event back to the web app."""
        await self.send({
            "event": "broadcast",
            "topic": f"realtime:{self.channel}",
            "payload": {
                "type": "broadcast",
                "event": "agent_status",
                "payload": payload,
            },
            "ref": self._next_ref(),
        })

    async def connect_and_listen(self):
        self.running = True
        while self.running:
            try:
                log.info(f"[agent] Connecting to Supabase Realtime: {self.channel}")
                async with websockets.connect(self.ws_url, ping_interval=30, ping_timeout=10) as ws:
                    self.ws = ws
                    log.info("[agent] Connected")

                    await self.send({
                        "event": "phx_join",
                        "topic": f"realtime:{self.channel}",
                        "payload": {"config": {"broadcast": {"ack": False, "self": False}}},
                        "ref": self._next_ref(),
                    })

                    log.info(f"[agent] Subscribed to {self.channel} — waiting for commands...")
                    print(f"\n✅  AI Council Desktop Agent is running")
                    print(f"   Channel: {self.channel}")
                    print(f"   Security: {'HMAC verification ON' if AGENT_SECRET else '⚠️  AGENT_SECRET not set — insecure'}")
                    print(f"   Waiting for commands from your AI Council...")
                    print(f"   Press Ctrl+C to stop\n")

                    async for raw_msg in ws:
                        await self._handle_message(raw_msg)

            except (websockets.ConnectionClosed, ConnectionRefusedError, OSError) as e:
                log.warning(f"[agent] Connection lost: {e} — retrying in 5s")
                await asyncio.sleep(5)
            except Exception as e:
                log.error(f"[agent] Unexpected error: {e} — retrying in 10s")
                await asyncio.sleep(10)

    async def _handle_message(self, raw: str):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        event = msg.get("event", "")

        # Heartbeat
        if event == "heartbeat":
            await self.send({
                "event": "heartbeat", "topic": "phoenix", "payload": {}, "ref": self._next_ref(),
            })
            return

        # Broadcast from web app
        if event == "broadcast":
            payload = msg.get("payload", {})
            inner   = payload.get("payload", {})

            if payload.get("event") == "desktop_command":
                asyncio.create_task(self._handle_command(inner))

            elif payload.get("event") == "cancel_command":
                request_id = inner.get("requestId", "")
                if request_id in self._cancel_flags:
                    log.info(f"[agent] Cancel requested for task {request_id}")
                    self._cancel_flags[request_id].set()
                else:
                    log.warning(f"[agent] Cancel for unknown requestId: {request_id}")

    async def _handle_command(self, cmd: dict):
        task       = cmd.get("task", "")
        request_id = cmd.get("requestId", "")
        token      = cmd.get("token", "")

        if not task:
            return

        # ── Security: verify auth token ────────────────────────
        user_id = verify_token(token)
        if user_id is None:
            log.error(f"[agent] Rejected task {request_id} — invalid token")
            await self.broadcast({
                "requestId": request_id,
                "status": "error",
                "error": "Unauthorized: invalid or missing auth token. Set AGENT_SECRET in .env.",
            })
            return

        log.info(f"[agent] Accepted task from {user_id} (id={request_id}): {task[:120]}")

        # Create a cancel flag for this task
        cancel_flag = asyncio.Event()
        self._cancel_flags[request_id] = cancel_flag

        # Acknowledge
        await self.broadcast({
            "requestId": request_id,
            "status":    "running",
            "step":      f"Task received: {task[:80]}…",
        })

        try:
            result = await run_computer_use_task(
                task,
                lambda status: self.broadcast({**status, "requestId": request_id}),
                cancel_flag,
            )

            if cancel_flag.is_set():
                await self.broadcast({
                    "requestId": request_id,
                    "status":    "error",
                    "error":     "Task was cancelled by user.",
                })
                log.info(f"[agent] Task {request_id} cancelled")
            else:
                await self.broadcast({
                    "requestId": request_id,
                    "status":    "done",
                    "result":    result,
                })
                log.info(f"[agent] Task {request_id} complete")

        except Exception as e:
            err = str(e)
            log.error(f"[agent] Task {request_id} failed: {err}")
            await self.broadcast({
                "requestId": request_id,
                "status":    "error",
                "error":     f"Error: {err}",
            })
        finally:
            # Clean up cancel flag
            self._cancel_flags.pop(request_id, None)

# ── Entry point ───────────────────────────────────────────────
def validate_config():
    missing = []
    if not ANTHROPIC_API_KEY: missing.append("ANTHROPIC_API_KEY")
    if not SUPABASE_URL:       missing.append("SUPABASE_URL")
    if not SUPABASE_ANON_KEY:  missing.append("SUPABASE_ANON_KEY")
    if missing:
        print(f"❌  Missing required config: {', '.join(missing)}")
        print(f"   Copy config.example.env to .env and fill in the values.")
        sys.exit(1)
    if not AGENT_SECRET:
        print("⚠️  WARNING: AGENT_SECRET is not set.")
        print("   Anyone with your Supabase anon key can send commands to this agent.")
        print("   Set AGENT_SECRET to your server's JWT_SECRET value.\n")

async def main():
    validate_config()
    agent = RealtimeAgent()
    try:
        await agent.connect_and_listen()
    except KeyboardInterrupt:
        print("\n👋  Desktop agent stopped.")

if __name__ == "__main__":
    asyncio.run(main())
    asyncio.run(main())
