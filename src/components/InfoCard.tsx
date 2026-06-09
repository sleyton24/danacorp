import React from 'react';

interface InfoCardProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const InfoCard: React.FC<InfoCardProps> = ({ title, icon, children, className = '' }) => {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${className}`}>
      <div className="px-6 py-4 border-b border-gray-50 bg-gray-50/50 flex items-center gap-3">
        <div className="text-blue-600">
          {icon}
        </div>
        <h3 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
};
