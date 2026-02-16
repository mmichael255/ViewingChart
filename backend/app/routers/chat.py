from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.services.llm_service import llm_service

router = APIRouter(
    prefix="/chat",
    tags=["chat"]
)

class ChatRequest(BaseModel):
    message: str
    chart_context: Optional[List[Dict[str, Any]]] = None

@router.post("/")
async def chat_endpoint(request: ChatRequest):
    """
    Chat with the AI. Pass 'chart_context' (array of candles) for context-aware answers.
    """
    try:
        response = await llm_service.chat(request.message, request.chart_context)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
