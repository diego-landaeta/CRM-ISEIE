import {
  FacebookLogo,
  GoogleLogo,
  TiktokLogo,
  MagnifyingGlass,
  Robot,
  Link as LinkIcon,
  UsersThree,
  Globe,
  WhatsappLogo,
  DotsThree,
} from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

const CHANNEL_STYLES = {
  meta_ads: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
  google_ads: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/30 dark:text-yellow-500',
  tiktok_ads: 'bg-pink-50 text-pink-600 dark:bg-pink-950/30 dark:text-pink-400',
  organico: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
  chatgpt_ia: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400',
  directo: 'bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400',
  referido: 'bg-teal-50 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400',
  web: 'bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400',
  whatsapp: 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400',
  otro: 'bg-slate-50 text-slate-600 dark:bg-slate-800/30 dark:text-slate-400',
};

export const CHANNEL_LABELS = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok Ads',
  organico: 'Orgánico',
  chatgpt_ia: 'ChatGPT IA',
  directo: 'Directo',
  referido: 'Referido',
  web: 'Web',
  whatsapp: 'WhatsApp',
  otro: 'Otro',
};

const CHANNEL_ICONS = {
  meta_ads: FacebookLogo,
  google_ads: GoogleLogo,
  tiktok_ads: TiktokLogo,
  organico: MagnifyingGlass,
  chatgpt_ia: Robot,
  directo: LinkIcon,
  referido: UsersThree,
  web: Globe,
  whatsapp: WhatsappLogo,
  otro: DotsThree,
};

/**
 * @param {{ channel: string | null | undefined; showIcon?: boolean; className?: string }} props
 */
export default function ChannelBadge({ channel, showIcon = true, className = '' }) {
  const key = channel || 'otro';
  const style = CHANNEL_STYLES[key] || CHANNEL_STYLES.otro;
  const label = CHANNEL_LABELS[key] || key;
  const Icon = CHANNEL_ICONS[key] || DotsThree;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
        style,
        className,
      )}
    >
      {showIcon && <Icon size={12} weight="bold" />}
      {label}
    </span>
  );
}
