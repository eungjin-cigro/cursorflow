import React from 'react';

interface ButtonProps {
  /**
   * The text to display on the button
   */
  label: string;
  /**
   * Click handler for the button
   */
  onClick?: () => void;
  /**
   * Visual variant of the button
   */
  variant?: 'primary' | 'secondary' | 'danger';
  /**
   * Whether the button is disabled
   */
  disabled?: boolean;
  /**
   * Size of the button
   */
  size?: 'small' | 'medium' | 'large';
  /**
   * Additional CSS class names
   */
  className?: string;
}

/**
 * A simple, reusable Button component
 */
export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  variant = 'primary',
  disabled = false,
  size = 'medium',
  className = '',
}) => {
  const baseStyles = 'rounded font-semibold transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const variantStyles = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
    secondary: 'bg-gray-600 hover:bg-gray-700 text-white focus:ring-gray-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  };
  
  const sizeStyles = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-2 text-base',
    large: 'px-6 py-3 text-lg',
  };
  
  const disabledStyles = 'opacity-50 cursor-not-allowed';
  
  const buttonClasses = [
    baseStyles,
    variantStyles[variant],
    sizeStyles[size],
    disabled && disabledStyles,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={buttonClasses}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
    >
      {label}
    </button>
  );
};

export default Button;
