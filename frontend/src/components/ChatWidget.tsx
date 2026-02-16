"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { KlineData } from "@/hooks/useMarketData";
import clsx from "clsx";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

interface ChatWidgetProps {
  chartData: KlineData[] | undefined;
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({ chartData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: "1", role: "ai", content: "Hi! I'm your market assistant. Ask me anything about the current chart." }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      // Use last 50 candles for context
      const context = chartData ? chartData.slice(-50) : [];
      
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          chart_context: context
        })
      });
      
      if (!res.ok) throw new Error("Failed to fetch response");
      
      const data = await res.json();
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: "ai", content: data.response };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "ai", content: "Sorry, I encountered an error." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 p-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all z-50"
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {/* Chat Window */}
      <div
        className={clsx(
          "fixed bottom-24 right-6 w-96 h-[500px] bg-[#1E222D] border border-gray-700 rounded-lg shadow-2xl flex flex-col transition-all z-50",
          isOpen ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-700 bg-[#2A2E39] rounded-t-lg">
          <h3 className="font-semibold text-white">Market AI Assistant</h3>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={clsx(
                "max-w-[80%] p-3 rounded-lg text-sm",
                msg.role === "user"
                  ? "ml-auto bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-200"
              )}
            >
              {msg.content}
            </div>
          ))}
          {isLoading && (
            <div className="bg-gray-700 text-gray-200 p-3 rounded-lg text-sm w-16 animate-pulse">
              ...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700 bg-[#2A2E39] flex gap-2 rounded-b-lg">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the trend..."
            className="flex-1 bg-[#131722] border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </>
  );
};
