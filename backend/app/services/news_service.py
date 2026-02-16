import requests
import xml.etree.ElementTree as ET
from typing import List, Dict, Any
from datetime import datetime

class NewsService:
    RSS_FEEDS = [
        {"source": "CoinDesk", "url": "https://www.coindesk.com/arc/outboundfeeds/rss/"},
        {"source": "Yahoo Finance", "url": "https://finance.yahoo.com/news/rssindex"}
    ]

    async def get_latest_news(self) -> List[Dict[str, Any]]:
        news_items = []
        for feed in self.RSS_FEEDS:
            try:
                response = requests.get(feed["url"], timeout=5)
                if response.status_code == 200:
                    root = ET.fromstring(response.content)
                    # Standard RSS parsing
                    for item in root.findall(".//item")[:5]: # Top 5 from each
                        title = item.find("title").text if item.find("title") is not None else "No Title"
                        link = item.find("link").text if item.find("link") is not None else "#"
                        pub_date = item.find("pubDate").text if item.find("pubDate") is not None else ""
                        
                        news_items.append({
                            "source": feed["source"],
                            "title": title,
                            "url": link,
                            "published_at": pub_date,
                            "sentiment": "Neutral" # Placeholder for AI sentiment analysis
                        })
            except Exception as e:
                print(f"Error fetching RSS from {feed['source']}: {e}")

        # Mock Social Data (since we don't have API keys)
        news_items.append({
            "source": "X (Twitter)",
            "title": "Bitcoin looking strong at support! 🚀 #BTC",
            "url": "#",
            "published_at": datetime.now().strftime("%a, %d %b %Y %H:%M:%S GMT"),
            "sentiment": "Bullish"
        })

        return news_items

news_service = NewsService()
