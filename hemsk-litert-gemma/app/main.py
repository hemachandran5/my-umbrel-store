import os
import sys
import time
import json
import uuid
import logging
import threading
import asyncio
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("litert-gemma")

# Environment Variables
PORT = int(os.environ.get("PORT", "8000"))
DATA_DIR = os.environ.get("DATA_DIR", "/data")
MODELS_DIR = os.path.join(DATA_DIR, "models")
MODEL_REPO = os.environ.get("MODEL_REPO", "litert-community/Gemma3-1B-IT")
MODEL_FILE = os.environ.get("MODEL_FILE", "gemma-3-1b-it.litertlm")
BACKEND_NAME = os.environ.get("BACKEND", "cpu").lower()
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip() or None
DEFAULT_SYSTEM_PROMPT = os.environ.get(
    "SYSTEM_PROMPT",
    "You are Gemma, a helpful, thoughtful, and capable AI assistant running locally on a Raspberry Pi 4 via Google LiteRT-LM."
)

os.makedirs(MODELS_DIR, exist_ok=True)
model_path = os.path.join(MODELS_DIR, MODEL_FILE)

# Global State
class AppState:
    status: str = "initializing"  # initializing, downloading, loading, ready, error
    status_message: str = "Starting up..."
    download_progress: Optional[float] = None
    engine: Any = None
    is_simulation: bool = False
    lock: threading.Lock = threading.Lock()

state = AppState()

# Try importing LiteRT-LM
LITERT_AVAILABLE = False
try:
    import litert_lm
    LITERT_AVAILABLE = True
    logger.info("Successfully imported Google LiteRT-LM runtime.")
except ImportError as e:
    logger.warning(f"LiteRT-LM native runtime not available ({e}). Running in simulation mode.")
    state.is_simulation = True

app = FastAPI(
    title="LiteRT Gemma Server",
    description="Google LiteRT-LM inference runtime with Gemma for umbrelOS",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas for OpenAI compatibility
class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of the author (system, user, assistant)")
    content: str = Field(..., description="Message text content")

class ChatCompletionRequest(BaseModel):
    model: Optional[str] = "gemma-3-1b-it"
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 512
    top_p: Optional[float] = 0.95
    stream: Optional[bool] = False

# Background Model Loader & Engine Initializer
def initialize_model_worker():
    global state, model_path
    try:
        if not os.path.exists(model_path):
            state.status = "downloading"
            state.status_message = f"Downloading {MODEL_FILE} from HuggingFace ({MODEL_REPO})..."
            logger.info(f"Model file not found at {model_path}. Initiating download from {MODEL_REPO}...")
            
            try:
                from huggingface_hub import hf_hub_download
                downloaded_file = hf_hub_download(
                    repo_id=MODEL_REPO,
                    filename=MODEL_FILE,
                    local_dir=MODELS_DIR,
                    token=HF_TOKEN
                )
                model_path = downloaded_file
                logger.info(f"Model successfully downloaded to: {model_path}")
            except Exception as dl_err:
                logger.error(f"Download failed: {dl_err}")
                # Check if there are any other .litertlm files in MODELS_DIR
                existing_models = [f for f in os.listdir(MODELS_DIR) if f.endswith(".litertlm")]
                if existing_models:
                    model_path = os.path.join(MODELS_DIR, existing_models[0])
                    logger.info(f"Fallback to existing local model: {model_path}")
                else:
                    state.status = "error"
                    state.status_message = f"Model download failed: {dl_err}. Please check your internet connection or HF token."
                    return

        state.status = "loading"
        state.status_message = f"Loading model weights into LiteRT-LM {BACKEND_NAME.upper()} engine..."
        logger.info(f"Initializing LiteRT-LM engine with model: {model_path} on {BACKEND_NAME} backend...")

        if LITERT_AVAILABLE:
            try:
                backend = litert_lm.Backend.CPU()
                state.engine = litert_lm.Engine(model_path, backend=backend)
                state.status = "ready"
                state.status_message = "Ready"
                state.is_simulation = False
                logger.info("LiteRT-LM Engine initialized and ready to serve inference requests!")
            except Exception as eng_err:
                logger.error(f"Failed to initialize LiteRT-LM Engine: {eng_err}")
                state.status = "error"
                state.status_message = f"Engine initialization error: {eng_err}"
        else:
            state.status = "ready"
            state.status_message = "Ready (Development / Simulation Mode)"
            state.is_simulation = True
            logger.info("Server ready in simulation mode.")

    except Exception as e:
        logger.exception("Unexpected error in model initialization")
        state.status = "error"
        state.status_message = f"Unexpected error: {e}"

@app.on_event("startup")
async def on_startup():
    threading.Thread(target=initialize_model_worker, daemon=True).start()

# API Endpoints
@app.get("/healthz")
def healthz():
    return {
        "status": "healthy" if state.status in ["ready", "downloading", "loading"] else "unhealthy",
        "engine_state": state.status,
        "message": state.status_message,
        "simulation": state.is_simulation,
        "model_file": MODEL_FILE,
        "model_repo": MODEL_REPO,
        "backend": BACKEND_NAME,
        "timestamp": time.time()
    }

@app.get("/api/status")
def get_status():
    return {
        "status": state.status,
        "message": state.status_message,
        "model": MODEL_FILE.replace(".litertlm", ""),
        "repo": MODEL_REPO,
        "simulation": state.is_simulation
    }

@app.get("/v1/models")
def list_models():
    model_id = MODEL_FILE.replace(".litertlm", "")
    return {
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "google",
                "permission": [],
                "root": model_id,
                "parent": None
            }
        ]
    }

def format_prompt_from_messages(messages: List[ChatMessage]) -> str:
    """Format messages into standard Gemma chat prompt format."""
    formatted = ""
    for msg in messages:
        if msg.role == "system":
            formatted += f"<start_of_turn>system\n{msg.content}<end_of_turn>\n"
        elif msg.role == "user":
            formatted += f"<start_of_turn>user\n{msg.content}<end_of_turn>\n"
        elif msg.role == "assistant":
            formatted += f"<start_of_turn>model\n{msg.content}<end_of_turn>\n"
    formatted += "<start_of_turn>model\n"
    return formatted

def stream_litert_response(prompt: str, model_id: str, request_id: str):
    created_time = int(time.time())
    
    if state.is_simulation or state.engine is None:
        # Simulation response for development / preview environments
        sim_response = (
            f"Hello from LiteRT Gemma! Running on your Raspberry Pi 4.\n\n"
            f"• Engine status: {state.status_message}\n"
            f"• Model target: {MODEL_REPO} ({MODEL_FILE})\n"
            f"• Acceleration: ARM Neon via XNNPACK CPU delegate.\n\n"
            f"You asked: \"{prompt.strip()}\"\n\n"
            f"Everything is connected and functioning properly."
        )
        for word in sim_response.split(" "):
            chunk_data = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model_id,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": word + " "},
                        "finish_reason": None
                    }
                ]
            }
            yield f"data: {json.dumps(chunk_data)}\n\n"
            time.sleep(0.04)

        done_chunk = {
            "id": request_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": model_id,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
        }
        yield f"data: {json.dumps(done_chunk)}\n\n"
        yield "data: [DONE]\n\n"
        return

    # Real LiteRT-LM Inference
    with state.lock:
        try:
            with state.engine.create_conversation() as conversation:
                for chunk in conversation.send_message_async(prompt):
                    token_text = ""
                    if isinstance(chunk, dict):
                        content = chunk.get("content", [])
                        if content and isinstance(content, list) and "text" in content[0]:
                            token_text = content[0]["text"]
                        else:
                            token_text = str(chunk.get("text", ""))
                    elif hasattr(chunk, "text"):
                        token_text = chunk.text
                    else:
                        token_text = str(chunk)

                    if token_text:
                        chunk_data = {
                            "id": request_id,
                            "object": "chat.completion.chunk",
                            "created": created_time,
                            "model": model_id,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {"content": token_text},
                                    "finish_reason": None
                                }
                            ]
                        }
                        yield f"data: {json.dumps(chunk_data)}\n\n"

            # Finish chunk
            done_chunk = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model_id,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
            }
            yield f"data: {json.dumps(done_chunk)}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            logger.exception("Inference error during streaming")
            err_chunk = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": created_time,
                "model": model_id,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": f"\n\n[Inference Error: {e}]"},
                        "finish_reason": "error"
                    }
                ]
            }
            yield f"data: {json.dumps(err_chunk)}\n\n"
            yield "data: [DONE]\n\n"

@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest):
    if state.status not in ["ready"]:
        raise HTTPException(
            status_code=503,
            detail=f"LiteRT-LM engine is not ready yet ({state.status}: {state.status_message}). Please wait."
        )

    model_id = req.model or MODEL_FILE.replace(".litertlm", "")
    request_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    prompt = format_prompt_from_messages(req.messages)

    if req.stream:
        return StreamingResponse(
            stream_litert_response(prompt, model_id, request_id),
            media_type="text/event-stream"
        )
    else:
        # Non-streaming aggregation
        collected = []
        for chunk_str in stream_litert_response(prompt, model_id, request_id):
            if chunk_str.startswith("data: ") and not chunk_str.startswith("data: [DONE]"):
                try:
                    payload = json.loads(chunk_str[6:].strip())
                    delta = payload["choices"][0]["delta"]
                    if "content" in delta:
                        collected.append(delta["content"])
                except Exception:
                    pass

        full_content = "".join(collected)
        return {
            "id": request_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_id,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": full_content
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(full_content.split()),
                "total_tokens": len(prompt.split()) + len(full_content.split())
            }
        }

# Mount static files and Web UI
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
def serve_ui():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>LiteRT Gemma Server Running</h1>")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
