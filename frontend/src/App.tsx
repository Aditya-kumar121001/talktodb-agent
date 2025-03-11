import React, { useState, useEffect, KeyboardEvent, useRef } from 'react';
import axios from 'axios';

// Define types for messages, movie results, and schema
interface Movie {
  title?: string;
  vote_average?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface Message {
  sender: 'user' | 'bot';
  results?: Movie[];
  text?: string;
  isStreaming?: boolean;
}

interface SchemaColumn {
  name: string;
  type: string;
}

// Navbar Component
const Navbar: React.FC = () => {
  return (
    <nav className="bg-gray-900 text-white py-2 px-4 flex justify-between items-center">
      {/* Logo */}
      <div className="text-blue-400 font-bold">
        TalkTODB
      </div>

      {/* Navigation Links */}
      {/* <div className="space-x-6">
        <a href="#" className="hover:text-gray-300">Product</a>
        <a href="#" className="hover:text-gray-300">Features</a>
        <a href="#" className="hover:text-gray-300">Marketplace</a>
        <a href="#" className="hover:text-gray-300">Company</a>
      </div> */}

      {/* Login Button */}
      <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-4 rounded">
        Log in
      </button>
    </nav>
  );
};

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [schema, setSchema] = useState<SchemaColumn[]>([]);
  const [isSchemaOpen, setIsSchemaOpen] = useState<boolean>(true);
  const [queryCache, setQueryCache] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<string>('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch schema on component mount
  useEffect(() => {
    const fetchSchema = async () => {
      try {
        const response = await axios.get<{ schema: SchemaColumn[] }>('http://localhost:3000/schema');
        setSchema(response.data.schema);
      } catch (error) {
        console.error('Error fetching schema:', error);
        setSchema([]);
      }
    };
    fetchSchema();
  }, []);

  // Scroll to the bottom of the chat area when messages update
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load cached queries from localStorage on mount
  useEffect(() => {
    const storedQueries = localStorage.getItem('queryCache');
    if (storedQueries) {
      setQueryCache(JSON.parse(storedQueries));
    }
  }, []);

  // Save queryCache to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('queryCache', JSON.stringify(queryCache));
  }, [queryCache]);

  // Update suggestion based on input
  useEffect(() => {
    console.log('Input:', input, 'QueryCache:', queryCache);
    if (input.trim()) {
      const matchingQuery = queryCache.find((query) =>
        query.toLowerCase().startsWith(input.toLowerCase())
      );
      if (matchingQuery) {
        const remainderQuery = matchingQuery.slice(input.length);
        setSuggestion(remainderQuery);
      } else {
        setSuggestion('');
      }
    } else {
      setSuggestion('');
    }
  }, [input, queryCache]);

  const sendMessage = async (): Promise<void> => {
    if (!input.trim()) return;

    if (!queryCache.includes(input)) {
      setQueryCache((prev) => [...prev, input]);
    }

    const userMessage: Message = { sender: 'user', text: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSuggestion('');

    const botMessage: Message = { sender: 'bot', text: '', isStreaming: true };
    setMessages((prev) => [...prev, botMessage]);

    try {
      const response = await axios.post<{ result: Movie[] }>(
        'http://localhost:3000/ask',
        { question: input }
      );
      const botResponse = response.data.result;

      let finalBotMessage: Message;

      if (botResponse && botResponse.length > 0) {
        if ('COUNT(*)' in botResponse[0]) {
          finalBotMessage = {
            sender: 'bot',
            text: `Total count: ${botResponse[0]['COUNT(*)']}`,
            isStreaming: false,
          };
        } else if (botResponse.length === 1 && Object.keys(botResponse[0]).length === 1) {
          const key = Object.keys(botResponse[0])[0];
          finalBotMessage = {
            sender: 'bot',
            text: `Result: ${botResponse[0][key]}`,
            isStreaming: false,
          };
        } else {
          finalBotMessage = {
            sender: 'bot',
            results: botResponse,
            isStreaming: false,
          };
        }
      } else {
        finalBotMessage = {
          sender: 'bot',
          text: 'No results found',
          isStreaming: false,
        };
      }

      setMessages((prev) =>
        prev.map((msg, idx) => (idx === prev.length - 1 ? finalBotMessage : msg))
      );
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        sender: 'bot',
        text: 'Error: Could not get a response from the server.',
        isStreaming: false,
      };
      setMessages((prev) =>
        prev.map((msg, idx) => (idx === prev.length - 1 ? errorMessage : msg))
      );
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      sendMessage();
    } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
      if (suggestion) {
        e.preventDefault();
        const matchingQuery = queryCache.find((query) =>
          query.toLowerCase().startsWith(input.toLowerCase())
        );
        if (matchingQuery) {
          setInput(matchingQuery);
          setSuggestion('');
        }
      }
    }
  };

  const suggestedPrompts = [
    "Top 10 action movies?",
    "What are the top 5 movies by World Gross revenue?",
    "Which studios have movies with an average score above 80?",
    "What is the average Opening Weekend revenue for Action genre movies?"
  ];

  const handlePromptClick = (prompt: string) => {
    setInput(prompt);
    sendMessage();
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <Navbar />
      <div className="flex flex-col md:flex-row items-start justify-center p-4 gap-4">
        {/* Left Panel: Collapsible Schema */}
        <div className="w-full md:w-1/4">
          <button
            onClick={() => setIsSchemaOpen(!isSchemaOpen)}
            className="w-full p-2 bg-gray-700 rounded-t-lg flex justify-between items-center hover:bg-gray-700 transition"
          >
            <h2 className="text-xl font-bold">Schema</h2>
            <span>{isSchemaOpen ? '▼' : '▶'}</span>
          </button>
          {isSchemaOpen && (
            <div className="p-4 bg-gray-800 rounded-b-lg shadow-lg">
              {schema.length > 0 ? (
                <ul className="space-y-1">
                  {schema.map((col, index) => (
                    <li key={index} className="flex justify-between items-center text-gray-200">
                      <span className="text-sm">{col.name}</span>
                      <span className="font-semibold text-sm">{col.type}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400">No schema available</p>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: Chatbot */}
        <div className="w-full md:w-3/4 flex flex-col h-[647px]">
          {/* Chat Area */}
          <div className="flex-1 overflow-y-auto mb-4 bg-gray-800 p-4 rounded-lg 
              [&::-webkit-scrollbar]:w-2
              [&::-webkit-scrollbar-track]:rounded-full
              [&::-webkit-scrollbar-track]:bg-gray-100
              [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb]:bg-gray-300
              dark:[&::-webkit-scrollbar-track]:bg-neutral-700
              dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`mb-2 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}
              >
                <div
                  className={`inline-block p-2 rounded-lg ${
                    msg.sender === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-700 text-gray-200'
                  }`}
                >
                  {msg.isStreaming ? (
                    <span>Typing...</span>
                  ) : msg.results ? (
                    <ul className="space-y-1">
                      {msg.results.map((movie, idx) => {
                        const keys = Object.keys(movie);
                        const titleKey = keys[0]; 
                        const secondKey = keys[1];
                        const secondValue = secondKey && typeof movie[secondKey] === 'number'
                          ? movie[secondKey].toFixed(1)
                          : '-';
                        return (
                          <li key={idx} className="flex justify-between gap-5">
                            <span>{movie[titleKey] || 'Movie'}</span>
                            <span className="font-semibold">{secondValue}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words">{msg.text}</pre>
                  )}
                </div>
                <div ref={chatEndRef} /> {/* Invisible div to scroll to down*/}
              </div>
            ))}
          </div>

          {/* Suggested Prompts */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4 w-full">
            {suggestedPrompts.map((prompt, index) => (
              <button
                key={index}
                onClick={() => handlePromptClick(prompt)}
                className="p-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition text-sm"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Chat Input */}
          <div className="relative w-full flex items-center bg-gray-800 rounded-lg p-2">
            {suggestion && input.trim() && (
              <div
                className="absolute inset-0 p-4 text-gray-500 pointer-events-none"
                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                <span className="text-white">{input}</span>
                <span>{suggestion}</span>
              </div>
            )}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask a question (e.g., 'how many action movies?' or 'top rated movies?')"
              className="flex-1 bg-transparent outline-none p-2 text-white placeholder-gray-400 text-md"
              style={{ color: suggestion && input.trim() ? 'transparent' : 'white' }}
              ref={inputRef}
            />
            <button
              onClick={sendMessage}
              className="p-2 text-gray-400 hover:text-white transition"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;