'use client';
import { useId, useState } from 'react';
import { Link2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function ICSLinkField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <>
      <label className="form-field" htmlFor={id}>
        Полная ссылка ICS
        <Input
          id={id}
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={4000}
          placeholder="https://…"
          aria-describedby={id + '-help'}
        />
      </label>
      <p className="setting-footnote" id={id + '-help'}>
        Вставьте ссылку целиком, вместе с токеном. Она хранится на сервере и не
        передаётся агенту.
      </p>
      <details className="compact-help">
        <summary>Где взять ссылку Data School</summary>
        <p>
          Профиль → iCal-календари → «Занятия» (classes.ics) или «Задания»
          (assignments.ics). Скопируйте адрес ссылки. Токен уже внутри;
          отдельный пароль и CalDAV не нужны.
        </p>
      </details>
    </>
  );
}

export function ReplaceICSLink({
  title,
  pending,
  submit,
  serverError,
}: {
  title: string;
  pending: boolean;
  submit: (url: string) => Promise<boolean>;
  serverError: string;
}) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [failed, setFailed] = useState(false),
    [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setUrl('');
          setFailed(false);
        }
      }}
    >
      <DialogTrigger
        className="icon-btn"
        aria-label={`Заменить ICS-ссылку: ${title}`}
        title="Заменить ICS-ссылку"
        disabled={pending}
      >
        <Link2 size={17} />
      </DialogTrigger>
      <DialogContent className="life-dialog calendar-dialog">
        <DialogHeader>
          <DialogTitle>Заменить ссылку ICS</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending || saving) return;
            setSaving(true);
            setFailed(false);
            try {
              if (await submit(url)) {
                setOpen(false);
                setUrl('');
              } else setFailed(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <ICSLinkField
            value={url}
            onChange={setUrl}
            disabled={pending || saving}
          />
          {failed && (
            <p role="alert" className="form-error">
              {serverError ||
                'Не удалось обновить ссылку. Старый календарь сохранён.'}
            </p>
          )}
          <button className="primary" disabled={pending || saving}>
            {pending || saving ? 'Проверяем…' : 'Сохранить и обновить'}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
