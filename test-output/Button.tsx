/**
 * Button component for test-output integration
 */

import React from 'react';

export interface ButtonProps {
  /** Button label text */
  label: string;
  /** Click handler */
  onClick?: () => void;
  /** Button variant style */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Disabled state */
  disabled?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Reusable Button component
 */
export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
  className = '',
}) => {
  const baseStyles = 'px-4 py-2 rounded font-medium transition-colors';
  
  const variantStyles = {
    primary: 'bg-blue-500 hover:bg-blue-600 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
  };

  const disabledStyles = 'opacity-50 cursor-not-allowed';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseStyles} ${variantStyles[variant]} ${
        disabled || loading ? disabledStyles : ''
      } ${className}`}
    >
      {loading ? 'Loading...' : label}
    </button>
  );
};

/**
 * Button type export for external use
 */
export type ButtonVariant = ButtonProps['variant'];

export default Button;
