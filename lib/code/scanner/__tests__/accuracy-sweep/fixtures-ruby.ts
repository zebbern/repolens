// Ruby fixture cases for scanner accuracy sweep

import type { FixtureCase } from './types'

export const rubyFixtures: FixtureCase[] = [
  // -----------------------------------------------------------------------
  // 1. system() with interpolated user input → TP
  // -----------------------------------------------------------------------
  {
    name: 'ruby-system-exec-injection',
    description: 'system("rm #{params[:file]}") — command injection via interpolation',
    file: {
      path: 'app/controllers/file_controller.rb',
      content: `class FileController < ApplicationController
  def destroy
    file = params[:file]
    system("rm #{file}")
    redirect_to files_path
  end
end`,
      language: 'ruby',
    },
    expected: [
      { ruleId: 'ruby-system-exec', line: 4, verdict: 'tp' },
      { ruleId: 'ruby-mass-assignment', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 2. params.permit! — mass assignment without restriction → TP
  // -----------------------------------------------------------------------
  {
    name: 'ruby-mass-assignment-permit-all',
    description: 'params.permit! allows all attributes — mass assignment risk',
    file: {
      path: 'app/controllers/users_controller.rb',
      content: `class UsersController < ApplicationController
  def create
    @user = User.new(params.permit!)
    if @user.save
      redirect_to @user
    end
  end
end`,
      language: 'ruby',
    },
    expected: [
      { ruleId: 'ruby-mass-assignment', line: 3, verdict: 'tp' },
    ],
  },

  // -----------------------------------------------------------------------
  // 3. Marshal.load with untrusted data → TP
  // -----------------------------------------------------------------------
  {
    name: 'ruby-marshal-load-cookies',
    description: 'Marshal.load(cookies[:data]) — insecure deserialization',
    file: {
      path: 'app/controllers/session_controller.rb',
      content: `class SessionController < ApplicationController
  def restore
    data = cookies[:data]
    session_obj = Marshal.load(data)
    @current_user = session_obj[:user]
  end
end`,
      language: 'ruby',
    },
    expected: [
      { ruleId: 'ruby-marshal-load', line: 4, verdict: 'tp' },
    ],
  },
]
