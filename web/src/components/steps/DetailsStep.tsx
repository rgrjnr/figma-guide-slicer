"use client";

interface Props {
  campaignName: string;
  subject: string;
  preheader: string;
  onChange: (patch: Partial<Record<"campaignName" | "subject" | "preheader", string>>) => void;
}

/** The wording that comes with the request. Proof recipients live on the last step. */
export function DetailsStep({ campaignName, subject, preheader, onChange }: Props) {
  return (
    <div className="step-body form">
      <div className="form-inner">
        <label className="field">
          <span>Nome da campanha</span>
          <input
            value={campaignName}
            onChange={e => onChange({ campaignName: e.target.value })}
            placeholder="20260901"
          />
          <small>Como ela vai aparecer no Braze. A data é a convenção usada.</small>
        </label>

        <label className="field">
          <span>Assunto</span>
          <input
            value={subject}
            onChange={e => onChange({ subject: e.target.value })}
            placeholder="O assunto que veio no pedido"
          />
          <small>Obrigatório — o Braze não envia nada sem assunto.</small>
        </label>

        <label className="field">
          <span>Texto de prévia <em>opcional</em></span>
          <input
            value={preheader}
            onChange={e => onChange({ preheader: e.target.value })}
            placeholder="Preenchido com o texto da arte, se houver"
          />
        </label>

      </div>
    </div>
  );
}
