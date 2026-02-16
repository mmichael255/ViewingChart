from typing import List, Dict, Any
import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

class LLMService:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self.llm = ChatOpenAI(api_key=api_key, model="gpt-3.5-turbo")
        else:
            self.llm = None
            print("OPENAI_API_KEY not found. Chat will run in mock mode.")

    async def chat(self, message: str, chart_context: List[Dict[str, Any]] = None) -> str:
        if not self.llm:
            return "I am a mock AI bot. Please set OPENAI_API_KEY in backend/.env to talk to real AI. " \
                   f"I see you sent: '{message}' and I have {len(chart_context) if chart_context else 0} candles of data."

        # Summarize context to avoid token limits
        context_str = ""
        if chart_context:
            # Take last 10 candles for brevity in this demo
            recent_data = chart_context[-10:] 
            context_str = f"Here is the recent market data (OHLCV) for the symbol:\n{recent_data}\n"

        system_prompt = "You are a helpful financial trading assistant. " \
                        "Use the provided market data to answer the user's questions about trends, price action, and potential setups. " \
                        "Be concise and professional."

        messages = [
            SystemMessage(content=system_prompt),
            SystemMessage(content=context_str),
            HumanMessage(content=message),
        ]

        response = await self.llm.ainvoke(messages)
        return response.content

llm_service = LLMService()
