import { useEffect, useRef } from 'react';
import { ArrowLeft, UserCircle, ChatCircleText } from '@phosphor-icons/react';
import type { Conversation, Message } from '../api/messages.api';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import { MARCA } from '@/shared/config/marca';

interface Props {
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  currentUserId: number;
  typingUsers?: number[];
  onSend: (body: string, referencedLeadId?: number) => Promise<void>;
  onTyping?: () => void;
  onDelete?: (msgId: number) => Promise<any>;
  onBack?: () => void;
}

export default function ChatPanel({ conversation, messages, loading, currentUserId, typingUsers = [], onSend, onTyping, onDelete, onBack }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typingUsers.length]);

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/10">
        <div className="text-center space-y-3 text-muted-foreground">
          <div className="w-20 h-20 mx-auto rounded-full bg-muted/40 flex items-center justify-center">
            <ChatCircleText size={40} weight="thin" />
          </div>
          <div>
            <p className="text-lg font-medium text-foreground/70">{MARCA} · Chat</p>
            <p className="text-xs mt-1">Selecciona una conversación o inicia una nueva</p>
          </div>
        </div>
      </div>
    );
  }

  const name = conversation.other_user?.nombre || 'Usuario';
  const isOtherTyping = typingUsers.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[radial-gradient(circle_at_20%_50%,rgba(120,119,198,0.03),transparent_50%),radial-gradient(circle_at_80%_50%,rgba(120,119,198,0.03),transparent_50%)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card/80 backdrop-blur-sm">
        {onBack && (
          <button onClick={onBack} className="md:hidden p-1.5 rounded-md hover:bg-muted">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center overflow-hidden">
          {conversation.other_user?.avatar_url
            ? <img src={conversation.other_user.avatar_url} alt="" className="w-full h-full object-cover" />
            : <UserCircle size={26} weight="fill" className="text-muted-foreground/70" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{name}</p>
          <p className="text-[10px] text-muted-foreground">
            {isOtherTyping ? (
              <span className="text-emerald-500 font-medium">escribiendo...</span>
            ) : (
              conversation.other_user?.email
            )}
          </p>
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-16 py-4">
        {loading && messages.length === 0 && (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-xs">Sin mensajes. Saluda.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDate = !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
          return (
            <div key={m.id}>
              {showDate && (
                <div className="flex justify-center my-4">
                  <span className="text-[10px] bg-muted/60 text-muted-foreground px-3 py-1 rounded-full font-medium">
                    {new Date(m.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
              )}
              <MessageBubble
                message={m}
                isOwn={m.sender_id === currentUserId}
                onDelete={onDelete && m.sender_id === currentUserId ? () => onDelete(m.id) : undefined}
              />
            </div>
          );
        })}
        {isOtherTyping && (
          <div className="flex justify-start mb-2">
            <div className="bg-card border border-border rounded-xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={onSend} onTyping={onTyping} />
    </div>
  );
}
