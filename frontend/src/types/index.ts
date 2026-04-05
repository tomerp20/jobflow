export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  width?: number;
}

export interface Card {
  id: string;
  stageId: string;
  position: number;
  companyName: string;
  roleTitle: string;
  applicationUrl?: string;
  careersUrl?: string;
  source?: string;
  location?: string;
  workMode: 'remote' | 'hybrid' | 'onsite';
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  dateApplied?: string;
  lastInteractionDate?: string;
  nextFollowupDate?: string;
  recruiterName?: string;
  recruiterEmail?: string;
  techStack: string[];
  tags: string[];
  interestLevel: number;
  companyIconUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardActivity {
  id: string;
  cardId: string;
  action: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  note?: string;
  createdAt: string;
}

export interface DashboardData {
  activeCount: number;
  byStage: { name: string; count: number }[];
  upcomingFollowUps: Card[];
  staleApplications: Card[];
}

export interface CardFilters {
  search?: string;
  stageId?: string;
  priority?: string;
  workMode?: string;
  tags?: string[];
}

export interface Todo {
  id: string;
  userId: string;
  cardId: string | null;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'active' | 'completed';
  position: number | null;
  createdAt: string;
  updatedAt: string;
}
