-- Quiz Tracking System Schema for LMS Platform
-- PostgreSQL DDL with proper constraints and indexes

-- Create ENUM types
CREATE TYPE difficulty_level AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- 1. quiz_exams table
CREATE TABLE quiz_exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL,
    month_number INTEGER NOT NULL,
    lesson_id UUID NULL,
    title TEXT NOT NULL,
    total_marks INTEGER NOT NULL DEFAULT 0,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Foreign key constraints
    CONSTRAINT fk_quiz_exams_course_id 
        FOREIGN KEY (course_id) 
        REFERENCES courses(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_quiz_exams_lesson_id 
        FOREIGN KEY (lesson_id) 
        REFERENCES course_content(id) 
        ON DELETE SET NULL,
    
    -- Check constraints
    CONSTRAINT chk_quiz_exams_month_number 
        CHECK (month_number > 0),
    
    CONSTRAINT chk_quiz_exams_total_marks 
        CHECK (total_marks >= 0),
    
    CONSTRAINT chk_quiz_exams_duration_minutes 
        CHECK (duration_minutes > 0)
);

-- 2. quiz_exam_questions table
CREATE TABLE quiz_exam_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_answer TEXT NOT NULL,
    marks INTEGER NOT NULL DEFAULT 1,
    difficulty difficulty_level NOT NULL DEFAULT 'MEDIUM',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Foreign key constraints
    CONSTRAINT fk_quiz_exam_questions_quiz_id 
        FOREIGN KEY (quiz_id) 
        REFERENCES quiz_exams(id) 
        ON DELETE CASCADE,
    
    -- Check constraints
    CONSTRAINT chk_quiz_questions_marks 
        CHECK (marks > 0),
    
    CONSTRAINT chk_quiz_questions_options 
        CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2)
);

-- 3. quiz_exam_attempts table
CREATE TABLE quiz_exam_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL,
    user_id UUID NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    total_marks INTEGER NOT NULL DEFAULT 0,
    percentage FLOAT NOT NULL DEFAULT 0.0,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMP WITH TIME ZONE NULL,
    rank INTEGER NULL,
    details JSONB NOT NULL DEFAULT '{}',
    
    -- Foreign key constraints
    CONSTRAINT fk_quiz_exam_attempts_quiz_id 
        FOREIGN KEY (quiz_id) 
        REFERENCES quiz_exams(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_quiz_exam_attempts_user_id 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE,
    
    -- Check constraints
    CONSTRAINT chk_quiz_attempts_score 
        CHECK (score >= 0),
    
    CONSTRAINT chk_quiz_attempts_total_marks 
        CHECK (total_marks >= 0),
    
    CONSTRAINT chk_quiz_attempts_percentage 
        CHECK (percentage >= 0.0 AND percentage <= 100.0),
    
    CONSTRAINT chk_quiz_attempts_submitted_after_started 
        CHECK (submitted_at IS NULL OR submitted_at >= started_at),
    
    CONSTRAINT chk_quiz_attempts_rank 
        CHECK (rank IS NULL OR rank > 0)
);

-- 4. quiz_exam_analytics table (optional cache table)
CREATE TABLE quiz_exam_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL,
    average_score FLOAT NOT NULL DEFAULT 0.0,
    highest_score FLOAT NOT NULL DEFAULT 0.0,
    lowest_score FLOAT NOT NULL DEFAULT 0.0,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    topper_id UUID NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Foreign key constraints
    CONSTRAINT fk_quiz_exam_analytics_quiz_id 
        FOREIGN KEY (quiz_id) 
        REFERENCES quiz_exams(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_quiz_analytics_topper_id 
        FOREIGN KEY (topper_id) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    -- Check constraints
    CONSTRAINT chk_quiz_analytics_scores 
        CHECK (average_score >= 0.0 AND average_score <= 100.0 
               AND highest_score >= 0.0 AND highest_score <= 100.0 
               AND lowest_score >= 0.0 AND lowest_score <= 100.0),
    
    CONSTRAINT chk_quiz_analytics_total_attempts 
        CHECK (total_attempts >= 0),
    
    CONSTRAINT chk_quiz_analytics_score_consistency 
        CHECK (lowest_score <= average_score AND average_score <= highest_score)
);

-- Create indexes for performance optimization

-- quiz_exams table indexes
CREATE INDEX idx_quiz_exams_course_id ON quiz_exams(course_id);
CREATE INDEX idx_quiz_exams_month_number ON quiz_exams(month_number);
CREATE INDEX idx_quiz_exams_lesson_id ON quiz_exams(lesson_id);
CREATE INDEX idx_quiz_exams_is_active ON quiz_exams(is_active);
CREATE INDEX idx_quiz_exams_created_at ON quiz_exams(created_at);
CREATE INDEX idx_quiz_exams_course_month ON quiz_exams(course_id, month_number);

-- quiz_exam_questions table indexes
CREATE INDEX idx_quiz_exam_questions_quiz_id ON quiz_exam_questions(quiz_id);
CREATE INDEX idx_quiz_exam_questions_difficulty ON quiz_exam_questions(difficulty);
CREATE INDEX idx_quiz_exam_questions_created_at ON quiz_exam_questions(created_at);

-- quiz_exam_attempts table indexes
CREATE INDEX idx_quiz_exam_attempts_quiz_id ON quiz_exam_attempts(quiz_id);
CREATE INDEX idx_quiz_exam_attempts_user_id ON quiz_exam_attempts(user_id);
CREATE INDEX idx_quiz_exam_attempts_score ON quiz_exam_attempts(score DESC);
CREATE INDEX idx_quiz_exam_attempts_percentage ON quiz_exam_attempts(percentage DESC);
CREATE INDEX idx_quiz_exam_attempts_rank ON quiz_exam_attempts(rank);
CREATE INDEX idx_quiz_exam_attempts_submitted_at ON quiz_exam_attempts(submitted_at);
CREATE INDEX idx_quiz_exam_attempts_quiz_user ON quiz_exam_attempts(quiz_id, user_id);
CREATE INDEX idx_quiz_exam_attempts_quiz_score ON quiz_exam_attempts(quiz_id, score DESC);

-- quiz_exam_analytics table indexes
CREATE INDEX idx_quiz_exam_analytics_quiz_id ON quiz_exam_analytics(quiz_id);
CREATE INDEX idx_quiz_exam_analytics_topper_id ON quiz_exam_analytics(topper_id);
CREATE INDEX idx_quiz_exam_analytics_created_at ON quiz_exam_analytics(created_at);

-- Create unique constraints
CREATE UNIQUE INDEX idx_quiz_exam_analytics_quiz_unique ON quiz_exam_analytics(quiz_id);

-- Add comments for documentation
COMMENT ON TABLE quiz_exams IS 'Stores quiz exam metadata and configuration';
COMMENT ON TABLE quiz_exam_questions IS 'Stores individual quiz exam questions with options and answers';
COMMENT ON TABLE quiz_exam_attempts IS 'Tracks user quiz exam attempts and scores';
COMMENT ON TABLE quiz_exam_analytics IS 'Cached analytics data for quiz exam performance metrics';

COMMENT ON COLUMN quiz_exams.lesson_id IS 'Optional link to specific lesson content';
COMMENT ON COLUMN quiz_exam_questions.options IS 'JSONB array of answer choices';
COMMENT ON COLUMN quiz_exam_attempts.details IS 'JSONB object storing user answers';
COMMENT ON COLUMN quiz_exam_attempts.rank IS 'User rank in this quiz exam (calculated)';
COMMENT ON COLUMN quiz_exam_analytics.topper_id IS 'User with highest score in this quiz exam';
