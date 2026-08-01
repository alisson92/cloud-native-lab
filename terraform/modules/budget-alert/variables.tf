variable "project_id" {
  description = "GCP project ID the budget scope is restricted to."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID (bare form, e.g. 000000-000000-000000) that owns the project."
  type        = string
}

variable "display_name" {
  description = "Human-readable name for the budget, shown in the Cloud Console."
  type        = string
  default     = "cloud-native-lab monthly budget"
}

variable "currency_code" {
  description = "ISO 4217 currency code for the budget amount."
  type        = string
  default     = "USD"
}

variable "amount" {
  description = "Monthly budget cap, in the unit of currency_code. Kept small: this is a lab, not production."
  type        = number
  default     = 20
}

variable "threshold_percents" {
  description = "Fractions of the budget (0.0-1.0+) at which an alert notification is triggered."
  type        = list(number)
  default     = [0.5, 0.9, 1.0]
}
