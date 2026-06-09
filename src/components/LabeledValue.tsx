import React from 'react';

interface LabeledValueProps {
  label: string;
  value: string | undefined;
  highlight?: boolean;
}

export const LabeledValue: React.FC<LabeledValueProps> = ({ label, value, highlight = false }) => {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">{label}</span>
      <span className={`text-base ${highlight ? 'text-blue-600 font-bold text-lg' : 'text-gray-900 font-medium'} truncate`}>
        {value || '-'}
      </span>
    </div>
  );
};
