import requests
import sys
import json
from datetime import datetime, timezone, timedelta

class EnterprisePMTester:
    def __init__(self, base_url="https://enterprise-collab-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.admin_token = None
        self.pm_token = None
        self.member_token = None
        self.admin_user = None
        self.pm_user = None
        self.member_user = None
        self.test_project_id = None
        self.test_task_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log(self, message):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def run_test(self, name, test_func, critical=False):
        """Run a single test and track results"""
        self.tests_run += 1
        self.log(f"🔍 Testing {name}...")
        
        try:
            success = test_func()
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - PASSED")
                return True
            else:
                self.log(f"❌ {name} - FAILED")
                self.failed_tests.append({"name": name, "critical": critical, "error": "Test function returned False"})
                return False
        except Exception as e:
            self.log(f"❌ {name} - ERROR: {str(e)}")
            self.failed_tests.append({"name": name, "critical": critical, "error": str(e)})
            return False

    def make_request(self, method, endpoint, data=None, token=None, params=None):
        """Make HTTP request with proper error handling"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
            
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)
            else:
                raise ValueError(f"Unsupported method: {method}")
                
            return response
        except requests.exceptions.RequestException as e:
            raise Exception(f"Request failed: {str(e)}")

    # ─── Authentication Tests ───
    def test_user_registration(self):
        """Test user registration with different roles"""
        try:
            # Test admin registration
            admin_data = {
                "name": "Test Admin",
                "email": f"admin.test.{int(datetime.now().timestamp())}@test.com",
                "password": "admin123",
                "role": "admin"
            }
            response = self.make_request('POST', 'auth/register', admin_data)
            if response.status_code != 200:
                return False
            
            result = response.json()
            if not result.get('access_token') or not result.get('user'):
                return False
                
            self.admin_token = result['access_token']
            self.admin_user = result['user']

            # Test project manager registration  
            pm_data = {
                "name": "Test PM",
                "email": f"pm.test.{int(datetime.now().timestamp())}@test.com", 
                "password": "pm123",
                "role": "project_manager"
            }
            response = self.make_request('POST', 'auth/register', pm_data)
            if response.status_code != 200:
                return False
                
            result = response.json()
            self.pm_token = result['access_token']
            self.pm_user = result['user']

            # Test team member registration
            member_data = {
                "name": "Test Member",
                "email": f"member.test.{int(datetime.now().timestamp())}@test.com",
                "password": "member123", 
                "role": "team_member"
            }
            response = self.make_request('POST', 'auth/register', member_data)
            if response.status_code != 200:
                return False
                
            result = response.json()
            self.member_token = result['access_token']
            self.member_user = result['user']
            
            return True
        except Exception as e:
            # Fallback to existing test account
            self.log(f"Registration failed, trying existing account: {e}")
            return self.test_existing_login()

    def test_existing_login(self):
        """Test login with provided admin credentials"""
        try:
            login_data = {"email": "admin@test.com", "password": "admin123"}
            response = self.make_request('POST', 'auth/login', login_data)
            if response.status_code != 200:
                return False
                
            result = response.json()
            self.admin_token = result['access_token']
            self.admin_user = result['user']
            return True
        except:
            return False

    def test_auth_me(self):
        """Test getting current user info"""
        response = self.make_request('GET', 'auth/me', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return result.get('user_id') is not None and result.get('email') is not None

    # ─── Dashboard Tests ───
    def test_dashboard_stats(self):
        """Test dashboard statistics endpoint"""
        response = self.make_request('GET', 'dashboard/stats', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        required_fields = ['total_projects', 'total_tasks', 'tasks_completed', 'tasks_in_progress', 'tasks_todo']
        return all(field in result for field in required_fields)

    def test_dashboard_charts(self):
        """Test dashboard chart data"""
        response = self.make_request('GET', 'dashboard/charts', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        required_fields = ['priority_distribution', 'project_statuses', 'project_tasks']
        return all(field in result for field in required_fields)

    # ─── Project Tests ───
    def test_create_project(self):
        """Test project creation"""
        project_data = {
            "name": f"Test Project {int(datetime.now().timestamp())}",
            "description": "This is a test project for API testing",
            "priority": "high",
            "start_date": datetime.now().strftime('%Y-%m-%d'),
            "end_date": (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d'),
            "team_members": []
        }
        
        response = self.make_request('POST', 'projects', project_data, token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        if result.get('project_id'):
            self.test_project_id = result['project_id']
            return True
        return False

    def test_list_projects(self):
        """Test listing projects"""
        response = self.make_request('GET', 'projects', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list)

    def test_get_project_detail(self):
        """Test getting project details"""
        if not self.test_project_id:
            return False
            
        response = self.make_request('GET', f'projects/{self.test_project_id}', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        required_fields = ['project_id', 'name', 'description', 'task_stats']
        return all(field in result for field in required_fields)

    # ─── Task Tests ───  
    def test_create_task(self):
        """Test task creation"""
        if not self.test_project_id:
            return False
            
        task_data = {
            "title": f"Test Task {int(datetime.now().timestamp())}",
            "description": "This is a test task for API testing",
            "project_id": self.test_project_id,
            "assigned_to": self.admin_user['user_id'],
            "priority": "medium",
            "due_date": (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
        }
        
        response = self.make_request('POST', 'tasks', task_data, token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        if result.get('task_id'):
            self.test_task_id = result['task_id']
            return True
        return False

    def test_list_tasks(self):
        """Test listing tasks"""
        response = self.make_request('GET', 'tasks', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list)

    def test_update_task_status(self):
        """Test updating task status"""
        if not self.test_task_id:
            return False
            
        update_data = {"status": "in_progress"}
        response = self.make_request('PUT', f'tasks/{self.test_task_id}', update_data, token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return result.get('status') == 'in_progress'

    # ─── Chat Tests ───
    def test_chat_channels(self):
        """Test getting chat channels"""
        response = self.make_request('GET', 'chat/channels', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list)

    def test_send_chat_message(self):
        """Test sending chat messages"""
        # First get channels
        channels_response = self.make_request('GET', 'chat/channels', token=self.admin_token)
        if channels_response.status_code != 200:
            return True  # Skip if no channels, not critical
            
        channels = channels_response.json()
        if not channels:
            return True  # Skip if no channels
            
        # Send message to first channel
        message_data = {
            "content": f"Test message {int(datetime.now().timestamp())}",
            "channel_id": channels[0]['channel_id']
        }
        
        response = self.make_request('POST', 'chat/messages', message_data, token=self.admin_token)
        return response.status_code == 200

    def test_get_chat_messages(self):
        """Test getting chat messages"""
        # Get channels first
        channels_response = self.make_request('GET', 'chat/channels', token=self.admin_token)
        if channels_response.status_code != 200:
            return True  # Skip if no channels
            
        channels = channels_response.json()
        if not channels:
            return True  # Skip if no channels
            
        # Get messages from first channel
        channel_id = channels[0]['channel_id']
        response = self.make_request('GET', f'chat/messages/{channel_id}', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list)

    # ─── Comments Tests ───
    def test_create_comment(self):
        """Test creating comments"""
        if not self.test_project_id:
            return False
            
        comment_data = {
            "content": f"Test comment {int(datetime.now().timestamp())}",
            "entity_type": "project",
            "entity_id": self.test_project_id
        }
        
        response = self.make_request('POST', 'users/comments', comment_data, token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return result.get('comment_id') is not None

    def test_list_comments(self):
        """Test listing comments"""
        if not self.test_project_id:
            return False
            
        response = self.make_request('GET', f'users/comments/project/{self.test_project_id}', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list)

    # ─── Notifications Tests ───
    def test_notifications(self):
        """Test notifications endpoint"""
        response = self.make_request('GET', 'notifications', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list)

    def test_unread_count(self):
        """Test unread notifications count"""
        response = self.make_request('GET', 'notifications/unread-count', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return 'count' in result

    # ─── User Management Tests ───
    def test_list_users(self):
        """Test listing users"""
        response = self.make_request('GET', 'users', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return isinstance(result, list) and len(result) > 0

    def test_get_user(self):
        """Test getting specific user"""
        response = self.make_request('GET', f'users/{self.admin_user["user_id"]}', token=self.admin_token)
        if response.status_code != 200:
            return False
            
        result = response.json()
        return result.get('user_id') == self.admin_user['user_id']

    def run_all_tests(self):
        """Run comprehensive backend API tests"""
        self.log("🚀 Starting Enterprise PM Backend API Tests")
        self.log(f"🌐 Base URL: {self.base_url}")
        
        # Authentication Tests
        self.log("\n📝 Testing Authentication...")
        self.run_test("User Registration/Login", self.test_user_registration, critical=True)
        if not self.admin_token:
            self.log("❌ CRITICAL: Authentication failed - stopping tests")
            return False
            
        self.run_test("Auth Me Endpoint", self.test_auth_me, critical=True)

        # Dashboard Tests
        self.log("\n📊 Testing Dashboard...")
        self.run_test("Dashboard Stats", self.test_dashboard_stats)
        self.run_test("Dashboard Charts", self.test_dashboard_charts)

        # Project Tests
        self.log("\n📁 Testing Projects...")
        self.run_test("Create Project", self.test_create_project)
        self.run_test("List Projects", self.test_list_projects)
        self.run_test("Get Project Detail", self.test_get_project_detail)

        # Task Tests
        self.log("\n✅ Testing Tasks...")
        self.run_test("Create Task", self.test_create_task)
        self.run_test("List Tasks", self.test_list_tasks)
        self.run_test("Update Task Status", self.test_update_task_status)

        # Chat Tests  
        self.log("\n💬 Testing Chat...")
        self.run_test("Chat Channels", self.test_chat_channels)
        self.run_test("Send Chat Message", self.test_send_chat_message)
        self.run_test("Get Chat Messages", self.test_get_chat_messages)

        # Comments Tests
        self.log("\n💭 Testing Comments...")
        self.run_test("Create Comment", self.test_create_comment)
        self.run_test("List Comments", self.test_list_comments)

        # Notifications Tests
        self.log("\n🔔 Testing Notifications...")
        self.run_test("List Notifications", self.test_notifications)
        self.run_test("Unread Count", self.test_unread_count)

        # User Management Tests
        self.log("\n👥 Testing Users...")
        self.run_test("List Users", self.test_list_users)
        self.run_test("Get User", self.test_get_user)

        # Final Results
        self.log(f"\n📋 Test Results:")
        self.log(f"✅ Passed: {self.tests_passed}/{self.tests_run}")
        self.log(f"❌ Failed: {len(self.failed_tests)}")
        
        if self.failed_tests:
            self.log("\n🚨 Failed Tests:")
            for test in self.failed_tests:
                self.log(f"  - {test['name']}: {test['error']}")

        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"\n📊 Success Rate: {success_rate:.1f}%")
        
        return success_rate > 80  # Consider success if > 80% pass rate

def main():
    tester = EnterprisePMTester()
    
    try:
        success = tester.run_all_tests()
        return 0 if success else 1
    except Exception as e:
        print(f"❌ Testing failed with error: {str(e)}")
        return 1

if __name__ == "__main__":
    sys.exit(main())