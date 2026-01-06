/**
 * Button component for test-output integration testing.
 */

import React from 'react';

export interface ButtonProps {
  /** Button label text */
  label: string;
  /** Click handler */
  onClick?: () => void;
  /** Button variant style */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether the button is in loading state */
  loading?: boolean;
}

/**
 * A reusable Button component with multiple variants.
 */
export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
  loading = false,
}) => {
  const baseStyles = 'px-4 py-2 rounded font-medium transition-colors';
  
  const variantStyles = {
    primary: 'bg-blue-500 hover:bg-blue-600 text-white',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={onClick}
      disabled={disabled || loading}
      type="button"
    >
      {loading ? 'Loading...' : label}
    </button>
  );
};

/**
 * Button component version for tracking.
 */
export const BUTTON_VERSION = '1.0.0';

export default Button;
